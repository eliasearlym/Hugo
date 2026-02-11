import { join, dirname } from "node:path";
import { readFile, cp, mkdir, rm, exists } from "node:fs/promises";
import { runUpdate, getPackageDir, getInstalledVersion } from "../workflows/bun";
import { parseManifest } from "../workflows/manifest";
import { MANIFEST_FILE } from "../workflows/constants";
import { readWorkflowState, writeWorkflowState, addEntry, findFileOwner } from "../workflows/state";
import { checkIntegrity } from "../workflows/integrity";
import { cleanEmptySkillDirs, collectManifestPaths } from "../workflows/sync";
import { hashFile } from "../workflows/utils";
import type { WorkflowEntry, InstalledFile, FileStatus } from "../workflows/types";

export type UpdatedWorkflow = {
  name: string;
  oldVersion: string;
  newVersion: string;
  updated: string[];
  added: string[];
  removed: string[];
  skipped: Array<{ path: string; reason: string }>;
};

export type UpdateResult = {
  workflows: UpdatedWorkflow[];
  unchanged: string[];
};

export async function update(
  opencodeDir: string,
  target?: string,
): Promise<UpdateResult> {
  // 1. Read and validate state before touching node_modules
  let state = await readWorkflowState(opencodeDir);

  if (state.workflows.length === 0) {
    throw new Error("No workflows installed.");
  }

  // 2. Resolve target to matching workflows and bun package spec
  let targetEntries = state.workflows;
  let bunPackageSpec: string | undefined;

  if (target) {
    const match = state.workflows.find(
      (w) => w.name === target || w.package === target,
    );
    if (!match) {
      throw new Error(
        `Workflow "${target}" is not installed. Run "hugo list" to see installed workflows.`,
      );
    }
    targetEntries = [match];
    bunPackageSpec = match.package;
  }

  // 3. Run bun update with the resolved package name (not the workflow name).
  //    NOTE: There is no rollback if post-update steps fail (e.g. missing
  //    manifest in the new version). node_modules will be updated but state
  //    will retain the old version. Recovery: `hugo rm` + `hugo i`.
  await runUpdate(opencodeDir, bunPackageSpec);

  const results: UpdatedWorkflow[] = [];
  const unchanged: string[] = [];
  const updatedEntries: WorkflowEntry[] = [];

  // Snapshot the target entries
  const entries = [...targetEntries];

  for (const entry of entries) {

    const packageDir = getPackageDir(opencodeDir, entry.package);

    // Check if version changed
    const newVersion = await getInstalledVersion(packageDir, entry.source);
    if (newVersion === entry.version) {
      unchanged.push(entry.name);
      continue;
    }

    // Re-read manifest from updated package
    const manifestPath = join(packageDir, MANIFEST_FILE);
    let manifestContent: string;
    try {
      manifestContent = await readFile(manifestPath, "utf-8");
    } catch {
      throw new Error(
        `Updated package "${entry.package}" no longer contains a ${MANIFEST_FILE} manifest.`,
      );
    }
    const manifest = parseManifest(manifestContent);

    // Run integrity check on current files
    const fileStatuses = await checkIntegrity(opencodeDir, entry);
    const statusMap = new Map<string, FileStatus>();
    for (const fs of fileStatuses) {
      statusMap.set(fs.file.destination, fs);
    }

    const updated: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    const newFiles: InstalledFile[] = [];

    // Process each file in the updated manifest
    const allManifestPaths = await collectManifestPaths(manifest, packageDir);

    for (const { sourcePath, destination } of allManifestPaths) {
      const sourceFullPath = join(packageDir, sourcePath);
      const destFullPath = join(opencodeDir, destination);
      const existingStatus = statusMap.get(destination);

      if (existingStatus) {
        // File existed before
        if (existingStatus.status === "modified") {
          skipped.push({ path: destination, reason: "locally modified" });
          // Keep the existing entry as-is
          newFiles.push(existingStatus.file);
          continue;
        }

        if (existingStatus.status === "deleted") {
          skipped.push({ path: destination, reason: "locally deleted" });
          continue;
        }

        // Clean — check if content actually changed
        const sourceHash = await hashFile(sourceFullPath);
        if (sourceHash === existingStatus.file.hash) {
          // No change in this file
          newFiles.push(existingStatus.file);
          continue;
        }

        // Content changed — overwrite
        await mkdir(dirname(destFullPath), { recursive: true });
        await cp(sourceFullPath, destFullPath, { dereference: true, force: true });
        newFiles.push({ source: sourcePath, destination, hash: sourceHash });
        updated.push(destination);
      } else {
        // New file — not in current state. Check for conflicts before copying.
        if (await exists(destFullPath)) {
          const owner = findFileOwner(state, destination);
          if (owner) {
            throw new Error(
              `File "${destination}" already exists from workflow "${owner.name}". Remove that workflow first.`,
            );
          }
          // Unmanaged file — skip with warning
          skipped.push({ path: destination, reason: "file already exists and is not managed by Hugo" });
          continue;
        }

        const hash = await hashFile(sourceFullPath);
        await mkdir(dirname(destFullPath), { recursive: true });
        await cp(sourceFullPath, destFullPath, { dereference: true, force: true });
        newFiles.push({ source: sourcePath, destination, hash });
        added.push(destination);
      }
    }

    // Handle files removed from manifest
    const newDestinations = new Set(allManifestPaths.map((p) => p.destination));
    for (const existingFile of entry.files) {
      if (newDestinations.has(existingFile.destination)) {
        continue; // Still in manifest, already handled
      }

      const status = statusMap.get(existingFile.destination);
      if (!status || status.status === "deleted") {
        // Already gone
        removed.push(existingFile.destination);
        continue;
      }

      if (status.status === "modified") {
        skipped.push({
          path: existingFile.destination,
          reason: "removed from manifest but locally modified",
        });
        newFiles.push(existingFile);
        continue;
      }

      // Clean — safe to delete
      const fullPath = join(opencodeDir, existingFile.destination);
      await rm(fullPath);
      removed.push(existingFile.destination);
    }

    // Clean up empty skill directories left behind by removed files
    if (removed.length > 0) {
      await cleanEmptySkillDirs(opencodeDir, removed);
    }

    // Accumulate the updated entry.
    // Uses manifest.name (not entry.name) so manifest renames propagate.
    // addEntry deduplicates by source, so the old-named entry is replaced.
    updatedEntries.push({
      name: manifest.name,
      package: entry.package,
      source: entry.source,
      version: newVersion,
      syncedAt: new Date().toISOString(),
      files: newFiles,
    });

    results.push({
      name: entry.name,
      oldVersion: entry.version,
      newVersion,
      updated,
      added,
      removed,
      skipped,
    });
  }

  // Apply all updates to state after iteration is complete
  for (const entry of updatedEntries) {
    state = addEntry(state, entry);
  }
  await writeWorkflowState(opencodeDir, state);

  return { workflows: results, unchanged };
}



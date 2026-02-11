import { join } from "node:path";
import { readFile, exists } from "node:fs/promises";
import {
  addDependency,
  removeDependency,
  parsePackageSpec,
  getInstalledVersion,
  getPackageDir,
  packageNameFromSource,
} from "../workflows/bun";
import { parseManifest } from "../workflows/manifest";
import { MANIFEST_FILE } from "../workflows/constants";
import { readWorkflowState, writeWorkflowState, addEntry, sourceEquals } from "../workflows/state";
import { syncWorkflow } from "../workflows/sync";
import type { WorkflowEntry, PackageSource } from "../workflows/types";

export type InstallResult = {
  workflowName: string;
  version: string;
  agents: number;
  skills: number;
  commands: number;
  warnings: string[];
};

export async function install(
  opencodeDir: string,
  packageSpec: string,
  options?: { force?: boolean },
): Promise<InstallResult> {
  const { source, warnings: parseWarnings } = parsePackageSpec(packageSpec);

  // 1. Snapshot deps before install (for git source resolution)
  const depsBefore = await readDeps(opencodeDir);

  // 2. Add dependency and install via bun
  await addDependency(opencodeDir, packageSpec);

  // 3. Resolve package name — needed for rollback if later steps fail
  //    NOTE: If this fails for git sources, rollback uses the raw spec (e.g.
  //    "github:org/repo"), which `bun remove` may not recognize. The dep can
  //    leak in package.json. This is acceptable — the failure case is rare
  //    (only when dep diffing can't identify the new package) and the leaked
  //    dep is harmless. A manual `bun remove <name>` cleans it up.
  let packageName: string;
  try {
    packageName = await resolvePackageName(opencodeDir, source, packageSpec, depsBefore);
  } catch (err) {
    await rollback(opencodeDir, packageSpec);
    throw err;
  }

  try {
    const packageDir = getPackageDir(opencodeDir, packageName);

    // 4. Read and parse manifest
    const manifestPath = join(packageDir, MANIFEST_FILE);
    let manifestContent: string;
    try {
      manifestContent = await readFile(manifestPath, "utf-8");
    } catch {
      throw new Error(
        `Package "${packageSpec}" does not contain a ${MANIFEST_FILE} manifest.`,
      );
    }
    const manifest = parseManifest(manifestContent);

    // 5. Resolve installed version
    const version = await getInstalledVersion(packageDir, source);

    // 6. Read existing workflow state
    const lock = await readWorkflowState(opencodeDir);

    // 7. Sync files (includes conflict detection, copying, hashing)
    const syncResult = await syncWorkflow(
      packageDir,
      manifest,
      opencodeDir,
      lock,
      manifest.name,
      { force: options?.force },
    );

    // 8. Create workflow entry
    const entry: WorkflowEntry = {
      name: manifest.name,
      package: packageName,
      source,
      version,
      syncedAt: new Date().toISOString(),
      files: syncResult.files,
    };

    // 9. Check if this replaces an existing workflow from the same source
    const replaced = lock.workflows.find(
      (w) => w.name !== manifest.name && sourceEquals(w.source, source),
    );
    if (replaced) {
      syncResult.warnings.push(
        `Replacing workflow "${replaced.name}" (same package source).`,
      );
    }

    // 10. Write updated workflow state
    const updatedLock = addEntry(lock, entry);
    await writeWorkflowState(opencodeDir, updatedLock);

    return {
      workflowName: manifest.name,
      version,
      agents: manifest.agents.length,
      skills: manifest.skills.length,
      commands: manifest.commands.length,
      warnings: [...parseWarnings, ...syncResult.warnings],
    };
  } catch (err) {
    await rollback(opencodeDir, packageName);
    throw err;
  }
}

/**
 * Best-effort cleanup: remove the dependency that was added before the failure.
 * Silently swallows errors — the original error is what matters.
 */
async function rollback(opencodeDir: string, packageSpec: string): Promise<void> {
  try {
    await removeDependency(opencodeDir, packageSpec);
  } catch {
    // Rollback is best-effort
  }
}

/**
 * Read current dependency names from .opencode/package.json.
 * Returns an empty set if the file doesn't exist yet.
 */
async function readDeps(opencodeDir: string): Promise<Set<string>> {
  const pkgJsonPath = join(opencodeDir, "package.json");
  if (!(await exists(pkgJsonPath))) {
    return new Set();
  }
  const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
  return new Set(Object.keys(pkgJson.dependencies ?? {}));
}

/**
 * For registry sources we can derive the package name directly.
 * For git sources, we diff package.json before/after `bun add`
 * to find exactly what was added.
 */
async function resolvePackageName(
  opencodeDir: string,
  source: PackageSource,
  originalSpec: string,
  depsBefore: Set<string>,
): Promise<string> {
  if (source.type === "registry") {
    return packageNameFromSource(source);
  }

  // Diff deps before/after to find the new entry
  const depsAfter = await readDeps(opencodeDir);
  const newDeps = [...depsAfter].filter((name) => !depsBefore.has(name));

  if (newDeps.length === 1) {
    return newDeps[0];
  }

  if (newDeps.length > 1) {
    throw new Error(
      `Multiple new dependencies detected after installing "${originalSpec}": ${newDeps.join(", ")}. ` +
        `Cannot determine which one is the workflow package.`,
    );
  }

  // No new deps — package may have already been in dependencies (reinstall).
  // Read the installed package.json to find the name bun resolved to.
  const pkgJsonPath = join(opencodeDir, "package.json");
  const pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
  const deps = pkgJson.dependencies ?? {};

  // Check if any existing dep's value matches the original spec
  for (const [name, value] of Object.entries(deps)) {
    if (value === originalSpec) {
      return name;
    }
  }

  throw new Error(
    `Could not determine package name for "${originalSpec}" after install. ` +
      `Check that the package was installed correctly.`,
  );
}

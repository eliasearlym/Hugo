import { join, dirname, basename } from "node:path";
import { mkdir, cp, readdir, rm, exists } from "node:fs/promises";
import type {
  WorkflowManifest,
  WorkflowState,
  InstalledFile,
  SyncResult,
} from "./types";
import { findFileOwner } from "./state";
import { AGENTS_DIR, SKILLS_DIR, COMMANDS_DIR } from "./constants";
import { hashFile } from "./utils";

export type ManifestPath = {
  sourcePath: string;
  destination: string;
};

/**
 * Flatten all manifest entries into source→destination pairs.
 * Agents/commands: single files into their respective dirs.
 * Skills: walk the package directory to enumerate all files.
 */
export async function collectManifestPaths(
  manifest: WorkflowManifest,
  packageDir: string,
): Promise<ManifestPath[]> {
  const paths: ManifestPath[] = [];

  for (const agent of manifest.agents) {
    paths.push({
      sourcePath: agent.path,
      destination: join(AGENTS_DIR, basename(agent.path)),
    });
  }

  for (const command of manifest.commands) {
    paths.push({
      sourcePath: command.path,
      destination: join(COMMANDS_DIR, basename(command.path)),
    });
  }

  for (const skill of manifest.skills) {
    const skillName = basename(skill.path);
    const skillFullPath = join(packageDir, skill.path);
    let files: string[];
    try {
      files = await walkDir(skillFullPath);
    } catch (err) {
      throw new Error(
        `Failed to read skill directory "${skill.path}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    for (const file of files) {
      paths.push({
        sourcePath: join(skill.path, file),
        destination: join(SKILLS_DIR, skillName, file),
      });
    }
  }

  return paths;
}

export async function syncWorkflow(
  packageDir: string,
  manifest: WorkflowManifest,
  opencodeDir: string,
  state: WorkflowState,
  currentWorkflowName: string,
): Promise<SyncResult> {
  const manifestPaths = await collectManifestPaths(manifest, packageDir);
  const files: InstalledFile[] = [];
  const warnings: string[] = [];

  try {
    for (const { sourcePath, destination } of manifestPaths) {
      const sourceFullPath = join(packageDir, sourcePath);
      const destFullPath = join(opencodeDir, destination);

      const conflict = await checkConflict(
        destFullPath,
        destination,
        state,
        currentWorkflowName,
      );
      if (conflict) {
        warnings.push(conflict);
        continue;
      }

      const hash = await hashFile(sourceFullPath);
      await mkdir(dirname(destFullPath), { recursive: true });
      await cp(sourceFullPath, destFullPath, { dereference: true, force: true });
      files.push({ source: sourcePath, destination, hash });
    }
  } catch (err) {
    // Clean up files already copied before this error
    for (const file of files) {
      try {
        await rm(join(opencodeDir, file.destination));
      } catch {
        // Best-effort cleanup
      }
    }
    throw err;
  }

  return { files, warnings };
}

async function checkConflict(
  destFullPath: string,
  destination: string,
  state: WorkflowState,
  currentWorkflowName: string,
): Promise<string | null> {
  if (!(await exists(destFullPath))) {
    return null;
  }

  const owner = findFileOwner(state, destination);

  if (owner && owner.name !== currentWorkflowName) {
    throw new Error(
      `File "${destination}" already exists from workflow "${owner.name}". Remove that workflow first.`,
    );
  }

  if (!owner) {
    return `File "${destination}" already exists and is not managed by Hugo. Skipping.`;
  }

  // Same workflow — check for local modifications
  const existingFile = owner.files.find((f) => f.destination === destination);
  if (existingFile) {
    const currentHash = await hashFile(destFullPath);
    if (currentHash !== existingFile.hash) {
      return `File "${destination}" has been locally modified. Skipping.`;
    }
  }

  // Clean file from same workflow — safe to overwrite
  return null;
}



const SKIP_NAMES = new Set(["node_modules", ".git"]);

/**
 * After deleting files, walk up from each file's parent directory
 * and remove empty directories until hitting the skills/ root.
 */
export async function cleanEmptySkillDirs(
  opencodeDir: string,
  deletedDestinations: string[],
): Promise<void> {
  const dirsToCheck = new Set<string>();

  for (const dest of deletedDestinations) {
    if (dest.startsWith(SKILLS_DIR + "/")) {
      dirsToCheck.add(dirname(dest));
    }
  }

  // Sort deepest first so we clean bottom-up
  const sorted = [...dirsToCheck].sort((a, b) => b.length - a.length);

  for (const dir of sorted) {
    if (dir === SKILLS_DIR) continue;

    let current = dir;
    while (current !== SKILLS_DIR && current.startsWith(SKILLS_DIR + "/")) {
      const fullPath = join(opencodeDir, current);
      try {
        const entries = await readdir(fullPath);
        if (entries.length === 0) {
          await rm(fullPath, { recursive: true });
          current = dirname(current);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
  }
}

export async function walkDir(dir: string, prefix = "", out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_NAMES.has(entry.name)) {
      continue;
    }

    const relPath = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      await walkDir(join(dir, entry.name), relPath, out);
    } else {
      out.push(relPath);
    }
  }

  return out;
}

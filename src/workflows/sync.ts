import { join } from "node:path";
import { cp, rm, stat } from "node:fs/promises";
import { fileExists, isNodeError } from "./utils";
import type { SkillSyncEntry, SkillSyncState } from "./types";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type SyncResult = {
  entries: Record<string, SkillSyncEntry>;
  warnings: string[];
};

export type UnsyncResult = {
  removed: string[];
  kept: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// syncSkills
// ---------------------------------------------------------------------------

/**
 * Copy skill directories from a package into .opencode/skills/.
 *
 * Used by: install, enable, switch (for newly enabled workflows).
 *
 * For each skill name:
 * - Source: <packageDir>/skills/<name>/ (entire directory)
 * - Dest:   <opencodeDir>/skills/<name>/
 * - If source doesn't exist -> warn, skip, no entry
 * - If source exists but has no SKILL.md -> warn, skip, no entry
 * - If dest doesn't exist -> recursively copy, entry = { status: "synced" }
 * - If dest already exists -> don't touch, entry = { status: "skipped" }, warn
 */
export async function syncSkills(
  opencodeDir: string,
  packageDir: string,
  skillNames: string[],
): Promise<SyncResult> {
  const results = await Promise.all(
    skillNames.map(async (name) => {
      const sourceDir = join(packageDir, "skills", name);
      const destDir = join(opencodeDir, "skills", name);

      const sourceExists = await directoryExists(sourceDir);
      if (!sourceExists) {
        return {
          warning: `Skill "${name}": package declares skill but directory is missing in package`,
        };
      }

      const skillMdExists = await fileExists(join(sourceDir, "SKILL.md"));
      if (!skillMdExists) {
        return {
          warning: `Skill "${name}": skill directory missing SKILL.md`,
        };
      }

      const destExists = await directoryExists(destDir);
      if (destExists) {
        return {
          entry: [name, { status: "skipped" } as SkillSyncEntry] as const,
          warning: `Skill "${name}": .opencode/skills/${name}/ already exists, skipping`,
        };
      }

      try {
        await cp(sourceDir, destDir, { recursive: true });
        return {
          entry: [name, { status: "synced" } as SkillSyncEntry] as const,
        };
      } catch (err) {
        await rm(destDir, { recursive: true, force: true });
        return {
          warning: `Skill "${name}": failed to copy — ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }),
  );

  const entries: Record<string, SkillSyncEntry> = {};
  const warnings: string[] = [];
  for (const result of results) {
    if (result.entry) entries[result.entry[0]] = result.entry[1];
    if (result.warning) warnings.push(result.warning);
  }
  return { entries, warnings };
}

// ---------------------------------------------------------------------------
// unsyncSkills
// ---------------------------------------------------------------------------

/**
 * Remove skill directories that Hugo previously synced.
 *
 * Used by: remove, disable, switch (for newly disabled workflows).
 *
 * Only removes skills with status "synced". Skills with "skipped" are left alone.
 * If syncState is undefined (workflow installed before this feature), nothing is unsynced.
 */
export async function unsyncSkills(
  opencodeDir: string,
  skillNames: string[],
  syncState: SkillSyncState | undefined,
): Promise<UnsyncResult> {
  if (!syncState) {
    return { removed: [], kept: [], warnings: [] };
  }

  const results = await Promise.all(
    skillNames.map(async (name) => {
      const entry = syncState[name];
      if (!entry || entry.status !== "synced") {
        return { kind: "kept" as const, name };
      }

      const destDir = join(opencodeDir, "skills", name);
      try {
        await rm(destDir, { recursive: true, force: true });
        return { kind: "removed" as const, name };
      } catch (err) {
        return {
          kind: "warning" as const,
          name,
          warning: `Skill "${name}": failed to remove — ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }),
  );

  const removed: string[] = [];
  const kept: string[] = [];
  const warnings: string[] = [];
  for (const result of results) {
    if (result.kind === "removed") removed.push(result.name);
    else if (result.kind === "kept") kept.push(result.name);
    else warnings.push(result.warning);
  }
  return { removed, kept, warnings };
}

// ---------------------------------------------------------------------------
// resyncSkills
// ---------------------------------------------------------------------------

/**
 * Reconcile skill directories after a workflow update.
 *
 * Used by: update.
 *
 * Three cases:
 * 1. Removed skills (in old, not in new) -> unsync (remove if "synced")
 * 2. New skills (in new, not in old) -> sync (copy if dest doesn't exist)
 * 3. Continuing skills (in both):
 *    - If "synced" -> remove and re-copy from updated package
 *    - If "skipped" -> check if dir still exists. If yes, stay "skipped".
 *      If user removed it, treat as new and sync.
 */
export async function resyncSkills(
  opencodeDir: string,
  packageDir: string,
  newSkillNames: string[],
  oldSkillNames: string[],
  oldSyncState: SkillSyncState | undefined,
): Promise<SyncResult> {
  const entries: Record<string, SkillSyncEntry> = {};
  const warnings: string[] = [];

  const newSet = new Set(newSkillNames);
  const oldSet = new Set(oldSkillNames);

  const removedNames = oldSkillNames.filter((name) => !newSet.has(name));
  if (removedNames.length > 0) {
    const unsyncResult = await unsyncSkills(opencodeDir, removedNames, oldSyncState);
    warnings.push(...unsyncResult.warnings);
  }

  const addedNames = newSkillNames.filter((name) => !oldSet.has(name));
  if (addedNames.length > 0) {
    const syncResult = await syncSkills(opencodeDir, packageDir, addedNames);
    Object.assign(entries, syncResult.entries);
    warnings.push(...syncResult.warnings);
  }

  const continuingNames = newSkillNames.filter((name) => oldSet.has(name));
  const continuingResults = await Promise.all(
    continuingNames.map(async (name) => {
      const oldEntry = oldSyncState?.[name];

      if (oldEntry?.status === "synced") {
        const destDir = join(opencodeDir, "skills", name);
        try {
          await rm(destDir, { recursive: true, force: true });
        } catch (err) {
          return {
            entries: {} as Record<string, SkillSyncEntry>,
            warnings: [
              `Skill "${name}": failed to remove old copy — ${err instanceof Error ? err.message : String(err)}`,
            ],
          };
        }
        return syncSkills(opencodeDir, packageDir, [name]);
      }

      if (oldEntry?.status === "skipped") {
        const destDir = join(opencodeDir, "skills", name);
        const destExists = await directoryExists(destDir);
        if (destExists) {
          return {
            entries: { [name]: { status: "skipped" } } as Record<string, SkillSyncEntry>,
            warnings: [] as string[],
          };
        }
      }

      return syncSkills(opencodeDir, packageDir, [name]);
    }),
  );

  for (const result of continuingResults) {
    Object.assign(entries, result.entries);
    warnings.push(...result.warnings);
  }

  return { entries, warnings };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function directoryExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

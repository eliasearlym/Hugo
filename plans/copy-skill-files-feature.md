# Skill File Syncing

## Problem

OpenCode discovers skills at `.opencode/skills/<name>/SKILL.md`. Workflow packages store them at `.opencode/node_modules/<pkg>/skills/<name>/SKILL.md`. There's no config bridge — OpenCode doesn't support pointing to skills in arbitrary paths. Hugo needs to copy skill directories into place and manage their lifecycle across install, remove, enable, disable, update, and switch.

## Design Principles

1. **Never overwrite.** If a skill directory already exists at the destination, Hugo does not touch it. Period.
2. **Always warn.** Every skip, every conflict produces a warning the user sees.
3. **Track ownership.** Hugo records sync status (`synced` or `skipped`) for each skill so it knows what it put there and what it left alone.
4. **Sandboxed.** All sync logic lives in one new file (`src/workflows/sync.ts`). When OpenCode adds config-based skill registration, this file is the only thing that changes.

## Scope

Skills only. Agents and commands are registered via the OpenCode plugin config hook — no file copying needed for those.

## What a Skill Is

A skill is a **directory**, not a single file. It contains a `SKILL.md` and potentially additional files and subdirectories (examples, templates, supporting docs, etc.). The entire directory must be copied as a unit — never individual files within it.

## Data Model

Sync state is stored on the existing `WorkflowEntry` in `opencode.json`:

```jsonc
{
  "hugo": {
    "workflows": {
      "code-review": {
        "package": "@acme/code-review",
        "version": "1.2.0",
        "agents": ["reviewer"],
        "commands": ["review"],
        "skills": ["code-review", "testing"],
        "mcps": [],
        "sync": {
          "skills": {
            "code-review": { "status": "synced" },
            "testing": { "status": "skipped" }
          }
        }
      }
    }
  }
}
```

Two statuses:

- **`synced`** — Hugo copied this skill directory. Safe for Hugo to remove on disable/remove, and safe to replace on update.
- **`skipped`** — A skill directory already existed at the destination. Hugo didn't touch it.

## Type Changes — `src/workflows/types.ts`

```ts
export type SkillSyncEntry = {
  status: "synced" | "skipped";
};

export type SkillSyncState = Record<string, SkillSyncEntry>;
```

Extend the existing `WorkflowEntry`:

```ts
export type WorkflowEntry = {
  package: string;
  version: string;
  agents: string[];
  commands: string[];
  skills: string[];
  mcps: string[];
  sync?: {
    skills: SkillSyncState;
  };
};
```

## New File — `src/workflows/sync.ts`

All filesystem sync logic lives here. Three exported functions.

### `syncSkills(opencodeDir, packageDir, skillNames)` -> `SyncResult`

Used by: install, enable, switch (for newly enabled workflows).

For each skill name:

- Source: `<packageDir>/skills/<name>/` (entire directory)
- Dest: `<opencodeDir>/skills/<name>/`
- If source directory doesn't exist -> warn ("package declares skill but directory is missing"), skip, no entry recorded
- If source exists but has no `SKILL.md` -> warn ("skill directory missing SKILL.md"), skip, no entry recorded
- If dest directory doesn't exist -> recursively copy source directory to dest, entry = `{ status: "synced" }`
- If dest directory already exists -> don't touch, entry = `{ status: "skipped" }`, add warning

Returns `{ entries: Record<string, SkillSyncEntry>, warnings: string[] }`

### `unsyncSkills(opencodeDir, skillNames, syncState)` -> `UnsyncResult`

Used by: remove, disable, switch (for newly disabled workflows).

For each skill name where sync state is `"synced"`:

- If skill directory exists -> recursively remove the entire `<name>/` directory, report as removed
- If directory is already gone (ENOENT) -> report as removed (user deleted it, nothing to do)

Skills with status `"skipped"` -> no action (Hugo didn't put them there).

If `syncState` is undefined (workflow installed before this feature existed), treat all skills as having no sync state — nothing to unsync.

Returns `{ removed: string[], kept: string[], warnings: string[] }`

### `resyncSkills(opencodeDir, packageDir, newSkillNames, oldSkillNames, oldSyncState)` -> `SyncResult`

Used by: update.

Three cases:

1. **Removed skills** (in old, not in new) -> unsync them (remove directory if `"synced"`)
2. **New skills** (in new, not in old) -> sync them (copy if dest doesn't exist)
3. **Continuing skills** (in both):
   - If previously `"synced"` -> remove the directory and re-copy from the updated package. This ensures synced skills always reflect the latest package version. Entry stays `{ status: "synced" }`.
   - If previously `"skipped"` -> check if directory still exists. If yes, stay `"skipped"`. If the user removed it, treat as new and sync it.

Returns `{ entries: Record<string, SkillSyncEntry>, warnings: string[] }`

## Collision Detection — `src/workflows/collisions.ts`

### Problem

After this feature, Hugo-synced skills create `.opencode/skills/<name>/SKILL.md`. The existing `checkSkillFileOverrides` function checks for that exact path and reports `"overridden-by-file"`. This would cause `hugo health` (and install/enable collision checks) to falsely report that a workflow's own synced skills are being "overridden" — when they ARE the workflow's files.

### Fix

Make `detectCollisions` and `checkSkillFileOverrides` sync-aware. Both gain an optional `syncState` parameter. When provided, synced skills are excluded from the file-existence check — Hugo put those files there.

```ts
// detectCollisions — public API:
// Before:
export async function detectCollisions(workflowName, manifest, config, projectDir, scope?)

// After:
export async function detectCollisions(workflowName, manifest, config, projectDir, scope?, syncState?)
```

```ts
// checkSkillFileOverrides — internal helper:
// Before:
async function checkSkillFileOverrides(warnings, names, opencodeDir)

// After:
async function checkSkillFileOverrides(warnings, names, opencodeDir, syncState?)
```

`detectCollisions` passes `syncState` through to `checkSkillFileOverrides`. Callers that don't pass `syncState` (or pass `undefined`) get the existing behavior — no change needed for call sites that don't have sync context.

### Affected callers

- **`install.ts`** — calls `detectCollisions` before sync runs, so no sync state exists yet. No change needed (passes `undefined` implicitly).
- **`enable.ts`** — calls `detectCollisions` before sync runs. No change needed.
- **`switch.ts`** — calls `detectCollisions` before sync runs. No change needed.
- **`health.ts`** — calls `detectCollisions` on already-installed workflows. **Must pass `entry.sync?.skills`** so that Hugo-synced skills are not falsely reported as user overrides.

## Command Integration

Each command gets a small addition: call into `sync.ts`, store the result on the workflow entry, surface warnings. The sync state is written to `opencode.json` as part of the existing `writeConfig` call — no extra writes.

| Command | Sync Action | When in the flow |
|---|---|---|
| **install** | `syncSkills()` | After manifest parse + collision detection, before `writeConfig` |
| **remove** | `unsyncSkills()` | After reading workflow entry from config, before `removeDependency` |
| **enable** | `syncSkills()` | After `addPlugin`, before `writeConfig` |
| **disable** | `unsyncSkills()` | After `removePlugin`, before `writeConfig` |
| **update** | `resyncSkills()` | After `bun update` + manifest re-read, before `writeConfig` |
| **switch** | `unsyncSkills()` for disabled then `syncSkills()` for enabled (order matters) | After plugin array changes, before `writeConfig` |

Each command already returns warnings in its result type. Sync warnings get merged into those.

### install.ts

After the manifest is parsed and collisions detected, call `syncSkills`. The returned entries go onto the `WorkflowEntry` before it's written to config. Sync warnings merge into the existing `warnings` array on `InstallResult`.

On rollback (if `writeConfig` fails), `unsyncSkills` should be called to clean up any copied files before `removeDependency`.

### remove.ts

Read the workflow's sync state from the existing entry. Call `unsyncSkills` before removing the dependency (the sync state is in `opencode.json`, not in the package, so package presence doesn't matter). Add a `syncWarnings` field to `RemoveResult` or merge into `bunWarning`.

### enable.ts

New imports needed: `getPackageDir` from `../workflows/bun`, `setWorkflow` from `../workflows/config`, `getOpencodeDir` from `../workflows/utils`, `syncSkills` from `../workflows/sync`.

After adding the plugin, resolve the package directory via `getPackageDir(getOpencodeDir(projectDir), entry.package)` and call `syncSkills`. Update the workflow entry's sync state via `setWorkflow`. Sync warnings merge into the per-workflow `warnings` array on `EnabledWorkflow`.

### disable.ts

New imports needed: `setWorkflow` from `../workflows/config`, `getOpencodeDir` from `../workflows/utils`, `unsyncSkills` from `../workflows/sync`.

After removing the plugin, call `unsyncSkills` using the workflow's stored sync state (`entry.sync?.skills`). Clear the sync state on the workflow entry via `setWorkflow` (the files are gone, the state is no longer meaningful). Add a `warnings` field to `DisabledWorkflow` (currently has none) for sync warnings.

### update.ts

After `bun update` and manifest re-read, call `resyncSkills` with old and new skill lists + old sync state (`target.entry.sync?.skills`). The returned entries replace the old sync state on the workflow entry. Sync warnings merge into the per-workflow `warnings` array.

### switch.ts

New imports needed: `getPackageDir` from `../workflows/bun`, `setWorkflow` from `../workflows/config`, `syncSkills` and `unsyncSkills` from `../workflows/sync`. `getOpencodeDir` is already available via existing imports or needs to be added.

**Ordering requirement:** Unsync all disabled workflows BEFORE syncing enabled ones. This matters when a disabled workflow synced a skill that an enabled workflow also declares — the directory must be removed first so the new workflow can copy its version. The current switch.ts code already runs the disable loop before the enable loop; the sync calls must follow this same ordering.

For each workflow being disabled, call `unsyncSkills` and clear its sync state. For each being enabled, call `syncSkills` and store its sync state. Sync warnings merge into the top-level `warnings` array on `SwitchResult`.

### health.ts

Pass the workflow's sync state to `detectCollisions` so that Hugo-synced skills are not falsely reported as file overrides:

```ts
// Before:
const warnings = await detectCollisions(target.name, manifest, config, projectDir, crossScope);

// After:
const warnings = await detectCollisions(target.name, manifest, config, projectDir, crossScope, target.entry.sync?.skills);
```

No new imports needed — `detectCollisions` is already imported and the sync state is already on the entry.

## CLI Presentation — `src/cli.ts`

The CLI handlers format and display results from command functions. Several handlers need updates to display sync warnings that would otherwise be silently swallowed.

### `handleDisable`

Currently prints `Disabled "<name>"` with no warnings. After this feature, `DisabledWorkflow` has a `warnings` field. Add a loop to print sync warnings (e.g. "could not remove skill directory") before the status line, matching the pattern used in `handleEnable`.

### `handleRemove`

Currently prints `result.bunWarning` if present. If sync warnings are added as a separate field (`syncWarnings: string[]`), add a loop to print them. If merged into the existing warning flow, ensure the format is consistent.

### `handleSwitch`

Currently prints collision warnings via `formatWarnings`. Sync warnings from unsync/sync operations should be printed in the same section. If sync warnings are `CollisionWarning[]` typed, they flow through `formatWarnings` automatically. If they're plain strings, add a separate display loop before or after the collision warnings.

### `handleInstall`, `handleEnable`, `handleUpdate`

These already display warnings. Sync warnings merge into the existing warning arrays in the command results, so they'll be displayed by the existing warning formatting code. No cli.ts changes needed for these — but verify during implementation that the warning types are compatible with `formatWarnings`.

## Edge Cases

- **Package declares a skill but the directory doesn't exist in the package.** Warn, skip, don't record in sync state.
- **Skill directory in package is missing SKILL.md.** Warn, skip, don't record in sync state. A skill directory without SKILL.md isn't a valid skill.
- **User deletes a Hugo-synced directory manually.** On disable/remove, the directory is already gone. `unsyncSkills` handles ENOENT gracefully — reports as removed, no error.
- **`--force` reinstall.** Existing sync state exists from previous install. `syncSkills` still respects "don't overwrite existing directories." Force only applies to the package-level reinstall, not directory syncing.
- **Multiple workflows declaring the same skill name.** Collision detection already catches this and warns. On sync, the first installed workflow copies the directory. The second sees it exists and gets `"skipped"`. On removal of the first, Hugo removes the directory. The second workflow's skills would need a re-enable to get synced.
- **Workflow has no skills.** `syncSkills` with an empty `skillNames` array is a no-op. Returns empty entries and no warnings.
- **Recursive directory copy failure mid-way.** If copying fails partway through (e.g. disk full, permission error), clean up the partially-copied destination directory before propagating the error. Don't leave partial skill directories.

## Execution Order

1. Add types to `src/workflows/types.ts` — `SkillSyncEntry`, `SkillSyncState`, extend `WorkflowEntry` with `sync?`
2. Create `src/workflows/sync.ts` — `syncSkills`, `unsyncSkills`, `resyncSkills`
3. Update `src/workflows/collisions.ts` — add optional `syncState` parameter to `detectCollisions` and `checkSkillFileOverrides`
4. Integrate into `src/commands/install.ts` — sync after manifest parse, store state, handle rollback
5. Integrate into `src/commands/remove.ts` — unsync before package removal
6. Integrate into `src/commands/enable.ts` — add new imports, sync when enabling, store state via `setWorkflow`
7. Integrate into `src/commands/disable.ts` — add new imports, unsync when disabling, clear sync state, add warnings to result type
8. Integrate into `src/commands/update.ts` — resync skills after update
9. Integrate into `src/commands/switch.ts` — add new imports, unsync disabled then sync enabled (order matters), update state via `setWorkflow`
10. Update `src/commands/health.ts` — pass `entry.sync?.skills` to `detectCollisions`
11. Update `src/cli.ts` — display sync warnings in `handleDisable`, `handleRemove`, and `handleSwitch`

# Skill File Syncing — Handoff

## What Was Done

Implemented the full skill file syncing feature as specified in `plans/copy-skill-files-feature.md`. Hugo now copies skill directories from workflow packages into `.opencode/skills/` where OpenCode can discover them, and manages their lifecycle across all workflow commands.

## Changes by File

### New Files

**`src/workflows/sync.ts`** — All filesystem sync logic, three exported functions:
- `syncSkills(opencodeDir, packageDir, skillNames)` — Copies skill directories from a package. Returns `{ entries, warnings }`. Validates source exists and contains `SKILL.md` before copying. Skips (never overwrites) if destination already exists. Cleans up partial copies on failure.
- `unsyncSkills(opencodeDir, skillNames, syncState)` — Removes skill directories that Hugo previously synced. Only removes `"synced"` entries, leaves `"skipped"` untouched. No-ops gracefully when `syncState` is undefined (pre-feature workflows) or directories are already gone.
- `resyncSkills(opencodeDir, packageDir, newSkillNames, oldSkillNames, oldSyncState)` — Reconciles skills after update. Handles three cases: removed skills (unsync), new skills (sync), continuing skills (re-copy if synced, leave if skipped, sync if user deleted a skipped one).

**`tests/unit/sync.test.ts`** — 21 unit tests covering all three functions and edge cases.

**`tests/fixtures/packages/skill-missing-dir/`** — Fixture declaring a skill with no directory in the package.

**`tests/fixtures/packages/skill-no-skillmd/`** — Fixture with a skill directory but no `SKILL.md`.

### Modified Files

**`src/workflows/types.ts`** — Added `SkillSyncEntry`, `SkillSyncState` types. Extended `WorkflowEntry` with optional `sync?: { skills: SkillSyncState }`.

**`src/workflows/collisions.ts`** — `detectCollisions` and `checkSkillFileOverrides` gained an optional `syncState` parameter. When a skill's sync status is `"synced"`, it's excluded from the file-override check (Hugo put those files there).

**`src/commands/install.ts`** — Calls `syncSkills` after manifest parse and collision detection. Stores sync entries on the `WorkflowEntry`. On rollback (writeConfig failure), calls `unsyncSkills` to clean up copied files before removing the package. Added `syncWarnings: string[]` to `InstallResult`.

**`src/commands/remove.ts`** — Calls `unsyncSkills` before `removeWorkflow` (the sync state lives on the entry, must be read first). Added `syncWarnings: string[]` to `RemoveResult`.

**`src/commands/enable.ts`** — New imports: `getPackageDir`, `setWorkflow`, `getOpencodeDir`, `syncSkills`. After adding the plugin, resolves the package directory and calls `syncSkills`. Updates the workflow entry's sync state via `setWorkflow`. Passes existing `entry.sync?.skills` to `detectCollisions` to avoid false override warnings. Added `syncWarnings: string[]` to `EnabledWorkflow`.

**`src/commands/disable.ts`** — New imports: `setWorkflow`, `getOpencodeDir`, `unsyncSkills`. After removing the plugin, calls `unsyncSkills`. Clears the sync state from the entry (deletes `sync` key). Added `warnings: string[]` to `DisabledWorkflow`.

**`src/commands/update.ts`** — Calls `resyncSkills` after manifest re-read with old and new skill lists plus old sync state. Sync warnings merge into the per-workflow `warnings` array. The `updated` flag is only driven by version/manifest changes (not sync state), but the entry is updated with fresh sync state when `updated` is true.

**`src/commands/switch.ts`** — New imports: `getPackageDir`, `setWorkflow`, `syncSkills`, `unsyncSkills`, `getOpencodeDir`. Unsyncs all disabled workflows first, then syncs enabled ones (order matters for shared skill names). Added `syncWarnings: string[]` to `SwitchResult`.

**`src/commands/health.ts`** — Passes `target.entry.sync?.skills` to `detectCollisions` so Hugo-synced skills aren't falsely reported as file overrides.

**`src/cli.ts`** — Displays `syncWarnings` in `handleInstall`, `handleRemove`, `handleEnable`, `handleDisable`, and `handleSwitch` with `⚠` prefix, matching existing warning formatting.

### Test Changes

21 new integration tests added across 7 test files, plus 21 unit tests in a new file. Total went from 245 to 287 tests.

| File | New Tests | What They Cover |
|---|---|---|
| `tests/unit/sync.test.ts` | 21 | All sync functions, edge cases (empty arrays, missing source, missing SKILL.md, existing dest, ENOENT, recursive ops, mixed outcomes, undefined sync state) |
| `tests/integration/install.test.ts` | 6 | Copies skills, records sync state, skips existing, warns on missing dir/SKILL.md, no sync state for skill-less workflows |
| `tests/integration/remove.test.ts` | 3 | Removes synced dirs, preserves skipped dirs, handles no-skills |
| `tests/integration/enable.test.ts` | 2 | Syncs on enable with state recording, syncWarnings when already exists |
| `tests/integration/disable.test.ts` | 4 | Removes synced, clears sync state, preserves skipped, handles no-skills |
| `tests/integration/update.test.ts` | 2 | Resyncs content on version bump, copies new subdirectories |
| `tests/integration/switch.test.ts` | 2 | Unsyncs disabled skills, syncs re-enabled skills |
| `tests/integration/health.test.ts` | 2 | Synced skills not reported as overrides, skills without sync state ARE reported |

## Deviations from the Plan

1. **`enable.ts` passes sync state to `detectCollisions`.** The plan said "no change needed" for enable's collision detection call. In practice, when a workflow is installed (skills synced), then disabled via direct config manipulation (bypassing our `disable()` — as the test helper does), the skill directory remains but so does the sync state on the entry. Without passing sync state, `detectCollisions` would falsely report the skill as a user override on re-enable.

2. **Sync warnings use separate `syncWarnings: string[]` fields** rather than merging into `CollisionWarning[]`. The plan suggested merging, but `CollisionWarning` is a structured type (`{ type, entity, name, detail }`) and sync warnings are descriptive strings. Forcing them into fake `CollisionWarning` objects would produce ugly output from `formatWarnings` (`⚠ Skill "name" Skill "name": ...`). Separate fields keep the types honest and the CLI handlers display them with the same `⚠` prefix.

3. **`update.ts` — `updated` flag excludes sync state changes.** The plan didn't specify this, but `resyncSkills` always re-copies synced skills (even when nothing changed), producing entries that would make `syncChanged` always true. This broke the "no changes reports up to date" test. The fix: `updated` is only driven by version/manifest changes. Sync state is still written to the entry when `updated` is true.

## What Wasn't Done

Nothing from the plan was left unimplemented. All 11 execution steps were completed and tested.

## How to Verify

```bash
bun test                # 287 tests, 0 failures
npx tsc --noEmit        # clean
```

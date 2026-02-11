# Workflow Management — Bug Fixes & Hardening

Fixes identified during code review of the workflow management system (Phase 1–5 + status command).

## Fixes (in order)

### 1. `resolvePackageName` — broken git source matching
**File:** `src/commands/install.ts`
**Problem:** The heuristic matching (`value.includes`, `originalSpec.includes(name)`) produces false positives. The fallback (last key in `dependencies`) is a guess.
**Fix:** Snapshot `package.json` dependencies before `bun add`, diff after to find the exact new key. Deterministic, no heuristics.

### 2. `addEntry` dedup mismatch with `removeEntry`
**File:** `src/workflows/state.ts`
**Problem:** `addEntry` deduplicates by source (URL/registry name), but `removeEntry` filters by workflow name. If a package is reinstalled and the manifest name changed, you get ghost entries.
**Fix:** `addEntry` should dedup by both name AND source — if either matches, replace.

### 3. `update` mutates state while iterating
**File:** `src/commands/update.ts`
**Problem:** `state = addEntry(state, updatedEntry)` reassigns inside `for (const entry of state.workflows)`. Works by accident (iterator holds original array ref), but any future read of `state.workflows` inside the loop reads stale data.
**Fix:** Iterate over a snapshot of entries. Accumulate updates separately, apply after the loop.

### 4. Corrupt `state.json` silently treated as empty
**File:** `src/workflows/state.ts`
**Problem:** If `state.json` exists but is malformed (bad JSON or missing `workflows` array), `readWorkflowState` silently returns empty state. This loses track of all installed workflows.
**Fix:** If the file exists, it must parse correctly. Throw on bad JSON. Throw if `workflows` is missing or not an array. Only return empty state when the file doesn't exist.

### 5. No validation on deserialized state entries
**File:** `src/workflows/state.ts`
**Problem:** `readWorkflowState` casts `raw as WorkflowState` without checking entry structure. Corrupted entries cause runtime crashes in downstream code.
**Fix:** Validate each entry has required fields (`name`, `package`, `source`, `version`, `files`). Validate `source` is a valid `PackageSource` discriminated union. Reject or warn on malformed entries.

### 6. `walkDir` copies dotfiles and junk
**File:** `src/workflows/sync.ts`
**Problem:** `.DS_Store`, `.git`, `node_modules` etc. inside a skill directory get copied.
**Fix:** Skip entries starting with `.` and skip `node_modules`. Simple blocklist.

### 7. GitHub shorthand ambiguity in `parsePackageSpec`
**File:** `src/workflows/bun.ts`
**Severity:** Design
**Problem:** `some-org/some-package` is treated as GitHub shorthand. But the user might have meant a scoped package and forgotten the `@`. Matches npm/bun behavior, but could silently do the wrong thing.
**Fix:** Add a warning when GitHub shorthand is detected, suggesting the user check if they meant `@some-org/some-package`.

### 8. `bun update` runs before state validation
**File:** `src/commands/update.ts`
**Severity:** Design
**Problem:** `runUpdate` mutates `node_modules` before state is read. If bun partially succeeds (updates some packages, fails on others), disk and state can diverge.
**Fix:** Read and validate state before calling `bun update`. If state is empty or missing, bail early before touching `node_modules`.

### 9. Redundant hash I/O after copy
**Files:** `src/workflows/sync.ts`, `src/commands/update.ts`
**Severity:** Minor
**Problem:** After `cp`, the destination file is read again to compute its hash. We could hash the source content before copying instead.
**Fix:** Hash the source file before copy and reuse that hash for the `InstalledFile` record.

### 10. `cleanEmptySkillDirs` only cleans one level deep
**File:** `src/commands/remove.ts`
**Severity:** Minor
**Problem:** Splits on `/` and takes `parts[1]` — only cleans the top-level skill directory. If a skill has nested subdirs (`skills/my-skill/sub/deep/`), intermediate empty dirs are orphaned after file deletion.
**Fix:** After deleting files, walk up from the deepest deleted path and remove each empty directory until hitting the `skills/` root.

# Refactors — Workflow Package Manager

Issues identified during test suite implementation. Neither is a crash or data loss bug under normal usage, but both violate the principle that Hugo should never touch files it doesn't own.

---

## Issue 1: Update overwrites unmanaged files when manifest adds new entries

**Severity:** Medium  
**File:** `src/commands/update.ts`, lines 139–146

### Problem

When `update` processes a new manifest version that introduces a file not present in the previous version, it copies the file to the destination with `{ force: true }` and no conflict check:

```typescript
} else {
  // New file — not in current state
  const hash = await hashFile(sourceFullPath);
  await mkdir(dirname(destFullPath), { recursive: true });
  await cp(sourceFullPath, destFullPath, { dereference: true, force: true });
  newFiles.push({ source: sourcePath, destination, hash });
  added.push(destination);
}
```

If the user had manually created a file at that destination (e.g., `agents/lint.md` they wrote themselves), the update silently overwrites it.

By contrast, `install` routes every file through `syncWorkflow` → `checkConflict`, which detects unmanaged files and skips them with a warning. The update path bypasses this entirely — it does its own file-by-file logic.

### Scenario

1. User creates `agents/lint.md` by hand (not part of any workflow).
2. User has `basic-workflow` v1 installed (no `agents/lint.md` in its manifest).
3. Workflow author publishes v2 which adds `agents/lint.md` to the manifest.
4. User runs `hugo update`.
5. Update sees `agents/lint.md` as a "new file" (not in current state), copies it with `force: true`.
6. User's manually created `agents/lint.md` is gone.

### Fix

Before copying a new file in the update path, check if the destination already exists. If it does:

- Call `findFileOwner(state, destination)` to see if another workflow owns it.
  - If owned by another workflow → throw (same as install does).
  - If unmanaged → skip with a warning, do NOT add to `newFiles`.
  - If not present on disk → proceed with copy.

This mirrors what `checkConflict` does in `syncWorkflow`. Consider extracting the conflict check into a shared utility rather than duplicating the logic.

### Tests to add

| Test | What it verifies |
|------|-----------------|
| Update adds new file that conflicts with unmanaged file | User's file is preserved, warning emitted, file not tracked in state |
| Update adds new file that conflicts with another workflow's file | Throws "already exists from workflow" error |
| Update adds new file to empty destination | File copied normally (existing behavior, regression guard) |

---

## Issue 2: `cleanEmptySkillDirs` can remove user-created empty directories

**Severity:** Low  
**File:** `src/workflows/sync.ts`, `cleanEmptySkillDirs`

### Problem

After `remove` or `update` deletes workflow-managed files from `skills/`, `cleanEmptySkillDirs` walks up from deleted file paths and removes any empty directories it finds under `skills/`. It has no concept of ownership — it just checks `readdir(dir).length === 0`.

If a user created an empty directory structure under `skills/` for their own purposes (e.g., a placeholder for a skill they're developing), and that directory shares a parent path with a removed workflow's skill, the cleanup could delete it.

### Scenario

1. Workflow installs files under `skills/analysis/scripts/`.
2. User creates `skills/analysis/drafts/` (empty, for their own use).
3. User runs `hugo remove <workflow>`.
4. Remove deletes `skills/analysis/scripts/run.sh`, then `cleanEmptySkillDirs` walks up.
5. `skills/analysis/scripts/` is empty → deleted.
6. `skills/analysis/` now contains only `drafts/` (non-empty) → kept. **This case is actually safe.**
7. But if `drafts/` is empty too → `skills/analysis/` has only an empty subdir. The current code doesn't recurse into siblings, so `skills/analysis/` is non-empty (it contains `drafts/`) → kept. **Also safe.**

On closer examination, the current code only walks UP from the specific paths of deleted files. It doesn't recurse into sibling directories. The risk is narrower than initially assessed:

**Actual risk:** Only if the user's empty directory is on the exact same path as a deleted workflow file's parent. For example:
1. Workflow has `skills/analysis/scripts/run.sh`.
2. User has nothing else in `skills/analysis/scripts/`.
3. Workflow is removed, `run.sh` deleted, `skills/analysis/scripts/` is empty → deleted.
4. This is correct behavior — the directory only existed because of the workflow.

The only genuinely bad case: the user created `skills/analysis/scripts/` independently (for their own files they plan to add later), AND a workflow also put files there, AND the workflow is removed. The empty dir the user wanted preserved gets cleaned up.

### Fix (if desired)

Option A: **Don't fix.** The scenario requires an unlikely coincidence (user creating an empty directory at the exact path a workflow uses). Empty directories have no content to lose. Document as a known limitation.

Option B: **Track created directories in state.** When `syncWorkflow` creates directories via `mkdir`, record them. Only clean directories that Hugo created. Adds complexity to state management for minimal benefit.

Option C: **Only clean directories that are completely under a skill path declared in the manifest.** Instead of walking up from individual file paths, limit cleanup to the skill root directories listed in the removed workflow's manifest. This is more conservative — it won't touch parent directories that might be shared with user content.

**Recommendation:** Option A. Document it and move on. The edge case is narrow and lossless (empty dirs).

---

## Summary

| Issue | Severity | Data risk | Fix effort |
|-------|----------|-----------|------------|
| Update overwrites unmanaged files | Medium | User file content lost | Small — add conflict check before copy in update path |
| cleanEmptySkillDirs removes user dirs | Low | Empty directory removed | Negligible risk, recommend documenting only |

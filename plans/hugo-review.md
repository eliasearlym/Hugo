# Hugo — Comprehensive Review

Baseline: 287 tests, 0 failures, 0 type errors. Codebase is disciplined — consistent patterns, good test coverage, clean separation of concerns. This review is a fine-tooth comb pass, not triage.

## Phase 1: Correctness & Stability

Things that could produce wrong behavior, data loss, or surprising failures under real-world conditions.

### 1.1 Race condition in read-modify-write cycle

**Files:** `src/workflows/config.ts` (lines 50-63), all commands that call `readConfig` → mutate → `writeConfig`

The codebase already documents this (config.ts comment on line 50), but it's worth reviewing whether any practical scenarios hit it — e.g. two `hugo install` invocations in parallel, or Hugo writing while OpenCode reads. Decide whether to accept the risk with better documentation, or add advisory file locking.

**Action:** Assess real-world risk. If low, add a clear user-facing note. If non-trivial, implement `flock`-based advisory locking.

### 1.2 JSONC comments stripped on write

**Files:** `src/workflows/config.ts` (line 62)

`readConfig` uses `jsonc-parser` (supports comments), but `writeConfig` uses `JSON.stringify` (strips comments). Any user comments in `opencode.json` are silently destroyed on the first mutating Hugo command. This is documented but not surfaced to users.

**Action:** Evaluate whether `jsonc-parser`'s `edit` / `applyEdits` API can preserve comments. If not feasible, at minimum warn the user on first write if the original file contained comments.

### 1.3 `install.ts` — config read timing for non-registry sources

**Files:** `src/commands/install.ts` (lines 63-108)

For registry sources, config is read before `bun add`. For git/file sources, config is read *after* `bun add`. This means the duplicate check happens post-download, wasting time and bandwidth. More importantly, the gap between the first `readConfig` (line 68) and `writeConfig` (line 167) is longer for registry sources (includes the entire install), increasing the race window from 1.1.

**Action:** Verify this ordering is intentional and document why, or refactor to read config once upfront for all source types.

### 1.4 `install.ts` — rollback doesn't undo plugin/workflow mutations on in-memory config

**Files:** `src/commands/install.ts` (lines 152-173)

If `writeConfig` fails (line 167), the rollback unsyncs skills and removes the dependency, but the in-memory `config` object still has the plugin added and workflow set. If the caller reuses this config object (they don't today, but it's fragile), it would contain stale state.

**Action:** Low priority but worth a defensive reset or a comment explaining why it's safe.

### 1.5 `switch.ts` — no rollback on partial failure

**Files:** `src/commands/switch.ts` (lines 106-144)

The disable-then-enable loop modifies config and syncs/unsyncs skills sequentially. If enabling the second workflow fails mid-loop, the first workflow is already disabled and its skills already unsynced, but `writeConfig` hasn't been called. The user ends up in an inconsistent state: the on-disk config still has the old state, but the filesystem has changed (skills removed).

**Action:** Either (a) collect all changes and apply atomically, or (b) write config after each step, or (c) document that switch is not atomic and suggest `enable`/`disable` for safe recovery.

### 1.6 `update.ts` — silent fallback to cached data masks real errors

**Files:** `src/commands/update.ts` (lines 89-116)

When version or manifest reads fail, the code warns and falls back to cached values. This means a corrupted package post-update will appear "up to date" rather than broken. The user sees a warning string but the `updated` flag is `false`.

**Action:** Consider whether this should be an error for single-workflow updates (`hugo update foo`) and a warning only for bulk updates. A specific workflow update request that can't verify success is arguably a failure.

### 1.7 `bun.ts` — dep-diffing for git/file sources is brittle

**Files:** `src/workflows/bun.ts` (lines 200-288)

The snapshot-diff approach (read deps before, read after, find the new one) has edge cases: transitive dependencies, monorepo packages that add multiple entries, or `bun add` updating existing deps as a side effect. The fallback chain (new → changed → source-match) is thorough but complex.

**Action:** Review whether any of these edge cases are realistic given Hugo's usage of `.opencode/node_modules`. Add integration tests for the trickier paths if missing.

### 1.8 `build.ts` — dynamic import with cache busting

**Files:** `src/commands/build.ts` (line 176)

`import(entryPath + "?t=" + Date.now())` works in Bun but is non-standard. If the module has side effects, repeated builds in the same process will execute them multiple times. The deep proxy mock (lines 376-389) mitigates SDK access, but arbitrary plugin code could do anything.

**Action:** Document the assumption that `hugo build` runs in its own process (CLI invocation), making the cache-bust safe. Add a comment about the side-effect risk if run programmatically.

### 1.9 `enable.ts` — returned entry doesn't reflect sync state update

**Files:** `src/commands/enable.ts` (lines 78-94)

When sync produces entries, `setWorkflow` is called with an updated entry, but the `results.push` on line 88 still uses the original `entry` (without sync state). The CLI doesn't use the sync state from the result, but any programmatic consumer would see stale data.

**Action:** Push `updatedEntry` instead of `entry` in the result, or document that the returned entry may not include sync state.

### 1.10 Error handling consistency

**Files:** All command files, `src/workflows/sync.ts`, `src/workflows/bun.ts`

Some errors use `throw new Error(...)`, some use custom error classes (`ManifestError`), some catch-and-warn. The pattern is mostly consistent within each file but varies across the codebase.

**Action:** Audit error handling patterns. Ensure: (a) user-facing errors always have clear messages, (b) internal errors are never swallowed silently, (c) `ManifestError` vs plain `Error` distinction is meaningful (callers that catch one should be able to distinguish from the other).

---

## Phase 2: Performance & Optimization

Things that are correct but could be faster or use fewer resources.

### 2.1 Sequential skill sync in loops

**Files:** `src/workflows/sync.ts` (lines 46-84), `src/workflows/sync.ts` (lines 179-209)

`syncSkills` processes skills sequentially (`for...of` with `await`). Each iteration does 2-3 stat calls + a recursive copy. For workflows with many skills, this could be parallelized with `Promise.all` (or `Promise.allSettled` for partial failure tolerance).

**Action:** Parallelize skill processing in `syncSkills`, `unsyncSkills`, and the continuing-skills loop in `resyncSkills`. Be mindful of the ordered rollback semantics — partial copy cleanup must still happen per-skill.

### 2.2 Sequential collision detection per workflow in switch/health

**Files:** `src/commands/switch.ts` (lines 121-128), `src/commands/health.ts` (lines 76-91)

Each workflow's collision detection is awaited sequentially. The checks are independent (they read the same config, do parallel file stats internally). Could run all workflows' checks in parallel.

**Action:** Use `Promise.all` for independent collision checks across workflows.

### 2.3 `collisions.ts` — redundant set creation per cross-check

**Files:** `src/workflows/collisions.ts` (lines 72)

`checkCrossCollisions` creates `new Set(theirs)` every time it's called. For N workflows each declaring M entities, the same "theirs" set is rebuilt for each entity type of each other workflow. Pre-compute all sets once.

**Action:** Build a lookup map of `{ [workflowName]: { agents: Set, commands: Set, skills: Set } }` once, then iterate.

### 2.4 `build.ts` — double stat in `scanSkillDirs`

**Files:** `src/commands/build.ts` (lines 424-471)

Two passes: first stat all entries to filter directories, then stat `SKILL.md` inside each directory. These could be combined into a single parallel pass that checks both `isDirectory()` and `SKILL.md` existence.

**Action:** Merge into a single `Promise.all` pass.

### 2.5 Repeated `readConfig` calls

**Files:** All command files

Every command starts with `readConfig(projectDir)`. If commands are ever composed (e.g., switch calls disable + enable internally, though it doesn't today), the config would be read multiple times. Currently not an issue, but worth keeping config-read as a single-entry-point pattern.

**Action:** No action needed today. Note for future: if composing commands, pass config as parameter.

---

## Phase 3: Formatting & Structure

Code organization, naming, API surface, documentation, and developer experience.

### 3.1 Inconsistent warning types across commands

**Files:** All command result types

- `InstallResult.warnings: CollisionWarning[]` + `syncWarnings: string[]`
- `RemoveResult.syncWarnings: string[]` + `bunWarning?: string`
- `EnabledWorkflow.warnings: CollisionWarning[]` + `syncWarnings: string[]`
- `DisabledWorkflow.warnings: string[]`
- `SwitchResult.warnings: CollisionWarning[]` + `syncWarnings: string[]`
- `WorkflowUpdateDetail.warnings: string[]`

There's no consistent pattern. Some commands use structured `CollisionWarning[]`, some use flat `string[]`, some have both. The CLI handles each case differently.

**Action:** Consider unifying around a single `Warning` type (with optional structured fields) or at minimum document the convention for each type. This is a non-trivial refactor — scope it carefully.

### 3.2 `Function` type in `build.ts`

**Files:** `src/commands/build.ts` (lines 296-297, 316, 320)

Uses the `Function` type which TypeScript's `@typescript-eslint` would flag. This is an inherently dynamic context (plugin detection via dynamic import), so the loose typing may be justified, but could use more specific types where possible.

**Action:** Replace with `(...args: unknown[]) => unknown` or similar where feasible. For the plugin factory specifically, type as `(ctx: unknown) => Promise<Record<string, unknown>>`.

### 3.3 Magic strings for entity types

**Files:** `src/workflows/collisions.ts`, `src/workflows/types.ts`

Entity types (`"agent" | "command" | "skill"`) and collision types are string literals repeated across the codebase. They're type-checked by TypeScript unions, which is sufficient, but a centralized const enum or const object would reduce repetition.

**Action:** Low priority. The TypeScript unions catch errors at compile time. Only worth extracting if the set of entity types grows.

### 3.4 `cli.ts` — handler functions could be more DRY

**Files:** `src/cli.ts`

Several handlers follow similar patterns: check args, call command, format warnings, print result. The structure is consistent but not abstracted. Whether to DRY this up is a taste question — the current explicit approach is very readable.

**Action:** No action recommended. The explicitness is a feature, not a bug. Each handler has enough unique logic (different arg requirements, different output formats) that abstracting would add complexity without reducing real duplication.

### 3.5 Plugin export resolution could use an explicit `hugo.plugin` field

**Files:** `src/commands/build.ts` (lines 311-350)

The plugin resolution heuristics (default export > single function > name matching > hooks object) are clever but fragile for edge cases. A declarative `"hugo": { "plugin": "MyPlugin" }` field in package.json would eliminate ambiguity.

**Action:** Consider adding optional `hugo.plugin` field support for explicit export naming, falling back to current heuristics. This is a feature decision, not a bug.

### 3.6 No `exports` field for CLI entry point

**Files:** `package.json` (lines 14-19)

The `exports` field only maps `"."` to the library entry. The CLI (`dist/cli.js`) isn't exported. This is fine for the bin field but means programmatic consumers can't import CLI internals. Likely intentional.

**Action:** Verify this is intentional. If CLI internals should be importable (e.g., for testing by consumers), add `"./cli"` to exports.

### 3.7 `utils.ts` — `fileExists` swallows all errors

**Files:** `src/workflows/utils.ts` (lines 45-52)

`fileExists` returns `false` on any error, including permission errors. This is usually fine (the caller treats "can't read" as "doesn't exist"), but could mask real problems in rare cases.

**Action:** Low priority. Document the behavior — this is a deliberate simplicity choice.

### 3.8 Test helpers duplicate production code

**Files:** `tests/helpers.ts` vs `src/workflows/utils.ts`

`helpers.ts` has its own `fileExists` and `readConfig` functions that are nearly identical to the production versions. This is common in test suites (avoiding import coupling), but if the production API changes, tests could silently test against different logic.

**Action:** Consider importing from production code, or add a comment noting the intentional duplication.

---

## Execution

Work through phases in order. Within each phase, items are roughly priority-ordered (highest impact first). Each item should be individually reviewable — don't bundle unrelated changes.

**Not in scope:** Feature additions, dependency upgrades, or README changes. This is a quality pass on existing code.

---

## To Do

Items are addressed one at a time, top to bottom. Current baseline: 290 tests, 0 failures, 0 type errors.

### Completed

- [x] **1.1** Race condition in read-modify-write cycle — Improved `writeConfig` comment to document why the risk is acceptable (single-user CLI, small file = atomic write) and when to revisit.
- [x] **1.2** JSONC comments stripped on write — `writeConfig` now uses `jsonc-parser`'s `modify`/`applyEdits` to apply targeted edits to the raw JSONC text, preserving user comments and formatting. Falls back to `JSON.stringify` for new files. Added 2 tests. (+2 tests)
- [x] **1.3** `install.ts` — config read timing for non-registry sources — Verified the ordering is intentional and correct. Registry reads config early to fast-fail before download; git/file reads config after install because the package name isn't known until bun resolves it. Reading config later for git/file is actually better (fresher config, narrower race window). File sources could theoretically pre-read the local package.json to learn the name early, but the improvement is marginal (rare scenario, fast local install) and adds a third resolution path. No change.

### Remaining

- [x] **1.4** `install.ts` — rollback doesn't undo in-memory config mutations — Added `removeWorkflow` + `removePlugin` calls in the catch block before filesystem rollback. The in-memory config is now fully restored if `writeConfig` fails.
- [x] **1.5** `switch.ts` — no rollback on partial failure — Wrapped the disable/enable mutation section in try/catch. On failure, rollback undoes enables (unsync newly synced skills) then redoes disables (re-sync previously unsynced skills) in reverse order, restoring the filesystem to pre-switch state. `syncSkills`/`unsyncSkills` handle errors internally so rollback is safe.

### Remaining

- [x] **1.6** `update.ts` — silent fallback to cached data masks real errors — Single-target updates (`hugo update foo`) now throw when version or manifest can't be read post-update. Bulk updates still warn and fall back to cached data. Updated 2 existing tests, added 1 new test for bulk warning path. (+1 test)
- [x] **1.7** `bun.ts` — dep-diffing for git/file sources is brittle — Reviewed edge cases (transitive deps, monorepo multi-adds, side-effect version bumps). None are realistic in `.opencode/`'s isolated context — only Hugo-managed direct deps, one entry per `bun add`. Existing tests cover the practical paths (new package, source-match via force reinstall). Added clarifying comments to the fallback chain. No new tests — untested paths require git fixtures or are defensive error throws for unrealistic scenarios.
- [x] **1.8** `build.ts` — dynamic import with cache busting — Expanded the existing comment to document why cache-busting is correct (needed for tests, harmless in CLI), the side-effect assumption (plugin entry points should be side-effect-free at module level), and why no code change is needed (deep proxy prevents SDK calls, 25 test invocations show no issues, subprocess alternative is worse).
- [x] **1.9** `enable.ts` — returned entry doesn't reflect sync state update — Hoisted `updatedEntry` out of the conditional so `results.push` uses the entry with sync state when it exists. CLI was unaffected (only reads agents/commands/skills/mcps), but programmatic consumers now see correct sync state.
- [x] **1.10** Error handling consistency audit — Audited all error patterns. User-facing errors all have clear messages ✓. No internal errors silently swallowed ✓. Removed `ManifestError` custom class — never caught by type in production code, provided no functional benefit over plain `Error`. Callers (install, update) catch generically and wrap with context. Updated 1 test.
- [x] **2.1** Sequential skill sync in loops — Parallelized all three functions: `syncSkills` (stat checks + copy), `unsyncSkills` (removals), and `resyncSkills` continuing-skills loop (rm + re-copy). Each skill's operation is independent (unique dest dir) with self-contained error handling. Scales to 20+ skills.
- [x] **2.2** Sequential collision detection per workflow — Parallelized `health.ts` (read-only, no mutations between iterations). Left `switch.ts` sequential — `addPlugin` between iterations creates a real dependency: enables cross-collision detection between workflows in the same batch.
- [x] **2.3** `collisions.ts` — redundant set creation per cross-check — No change. Each of the 3 `checkCrossCollisions` calls per workflow creates a set from a different array (agents, commands, skills) — no redundancy within a single `detectCollisions` call. Cross-call redundancy (health checking N workflows) is moot after 2.2 parallelized health. Set construction from small manifest arrays is microseconds regardless.
- [x] **2.4** `build.ts` — double stat in `scanSkillDirs` — Merged two sequential `Promise.all` passes into one. Each callback now checks `isDirectory()` and, if true, immediately checks `SKILL.md`. Simpler code (one pass, no intermediate filter) and one fewer round of parallel I/O.
- [x] **2.5** Repeated `readConfig` calls — No action needed. Each command reads config once. Review notes this as a future concern only if commands are composed internally (pass config as parameter instead of re-reading).
- [x] **3.1** Inconsistent warning types across commands — Audited all warning patterns. Two consistent categories exist: collision warnings (`CollisionWarning[]`) and sync/operation warnings (`string[]`). The main inconsistency was `disable`'s `warnings: string[]` field holding sync warnings — renamed to `syncWarnings` to match install/enable/switch/remove. Updated CLI handler and 2 tests. Full unification into a single Warning type would be high churn for marginal benefit.
- [x] **3.2** `Function` type in `build.ts` — Skipped. The `Function` type (4 uses in `PluginExport`, casts, and `isHooksObject` guard) is appropriate here. These are dynamically imported third-party plugin modules whose shapes are unknown at compile time. Runtime `typeof v === "function"` checks before every call are the real safety mechanism, and those are solid. Replacing with `(...args: unknown[]) => unknown` would satisfy linters but adds no actual safety and makes the type guard uglier. No change.
- [x] **3.3** Magic strings for entity types — Skipped. The `"agent" | "command" | "skill"` literals appear ~10 times across 2 files, all constrained by TypeScript union types. Compiler catches typos. No runtime iteration over the set. A const enum or const object would add indirection with no safety benefit. Only worth revisiting if a 4th entity type is added.
- [x] **3.4** `cli.ts` — handler functions could be more DRY — Skipped (review recommends no action). Each handler has genuinely different arg validation, result shapes, and output formatting. Shared patterns are already extracted (`formatWarnings`, `formatCount`, `warnExtraArgs`). Abstracting further would mean a generic framework for 9 different result types — more complex, harder to read.
- [x] **3.5** Plugin export resolution — explicit `hugo.plugin` field — Skipped. This is a feature request, not a quality issue. Current heuristics (default export → single function → name match → hooks object) work for all existing plugins. Adding a new resolution path isn't justified until someone hits an actual ambiguity. `hugo.plugin` is the right answer when that happens.
- [x] **3.6** No `exports` field for CLI entry point — Skipped. Intentional and correct. The `bin` field handles CLI usage. The `exports` field maps `"."` to the library API. CLI internals should not be importable by consumers.
- [x] **3.7** `utils.ts` — `fileExists` swallows all errors — Skipped. Already documented in the function's JSDoc. Every caller uses it as a guard before read/write — if stat fails for any reason, the subsequent operation would also fail with a clearer error message. Functionally correct.
- [x] **3.8** Test helpers duplicate production code — Skipped. The duplication is intentional and healthy. Test `readConfig` is a raw `JSON.parse` assertion helper, not a reimplementation of production JSONC parsing. Tests verify production behavior through command APIs, then use helpers to inspect output files. Test `fileExists` is 6 identical lines — importing from production would create coupling that harms test isolation.

# Hugo — Test Review

Baseline: 290 tests across 16 files, 0 failures, 692 expect() calls. Test suite is well-structured (unit/ and integration/ separation, fixture packages, shared helpers). This review checks for dead tests, weak assertions, missing coverage, and correctness.

## Structural mapping

| Source module | Test file | Notes |
|---|---|---|
| `commands/install.ts` | `integration/install.test.ts` | |
| `commands/remove.ts` | `integration/remove.test.ts` | |
| `commands/update.ts` | `integration/update.test.ts` | |
| `commands/enable.ts` | `integration/enable.test.ts` | |
| `commands/disable.ts` | `integration/disable.test.ts` | |
| `commands/switch.ts` | `integration/switch.test.ts` | |
| `commands/list.ts` | `integration/list.test.ts` | |
| `commands/health.ts` | `integration/health.test.ts` | |
| `commands/build.ts` | `integration/build.test.ts` | |
| `cli.ts` | `integration/cli.test.ts` + `e2e.test.ts` | |
| `workflows/config.ts` | `unit/config.test.ts` | |
| `workflows/sync.ts` | `unit/sync.test.ts` | |
| `workflows/bun.ts` | `unit/bun.test.ts` | |
| `workflows/manifest.ts` | `unit/manifest.test.ts` | |
| `workflows/utils.ts` | `unit/utils.test.ts` | |
| `workflows/collisions.ts` | — | No dedicated test; covered indirectly via health/install/enable |
| `workflows/types.ts` | — | Type-only, no test needed |
| `index.ts` | — | Re-export, no test needed |
| `mcp/index.ts` | — | No test |
| `mcp/grep_app.ts` | — | No test |
| `mcp/websearch.ts` | — | No test |
| `mcp/context7.ts` | — | No test |

---

## Phase 1: Unit tests

Read each unit test file once. For each, assess: dead tests, weak assertions, missing edge cases, correctness. Only reference production code when a test's intent is ambiguous.

### 1.1 `unit/config.test.ts`

- [ ] Review

### 1.2 `unit/sync.test.ts`

- [ ] Review

### 1.3 `unit/bun.test.ts`

- [ ] Review

### 1.4 `unit/manifest.test.ts`

- [ ] Review

### 1.5 `unit/utils.test.ts`

- [ ] Review

---

## Phase 2: Integration tests

Same criteria as Phase 1, plus: are integration tests testing through the public command API (not reimplementing internals)? Do they cover the full lifecycle (setup → action → verify state → cleanup)?

### 2.1 `integration/install.test.ts`

- [ ] Review

### 2.2 `integration/remove.test.ts`

- [ ] Review

### 2.3 `integration/update.test.ts`

- [ ] Review

### 2.4 `integration/enable.test.ts`

- [ ] Review

### 2.5 `integration/disable.test.ts`

- [ ] Review

### 2.6 `integration/switch.test.ts`

- [ ] Review

### 2.7 `integration/list.test.ts`

- [ ] Review

### 2.8 `integration/health.test.ts`

- [ ] Review

### 2.9 `integration/build.test.ts`

- [ ] Review

### 2.10 `integration/cli.test.ts`

- [ ] Review

### 2.11 `integration/e2e.test.ts`

- [ ] Review

---

## Phase 3: Test infrastructure

### 3.1 `tests/helpers.ts`

- [ ] Review — are helpers correct, are any unused, could any be simplified?

### 3.2 Fixtures audit

- [ ] Review — are all fixture packages used? Any orphaned? Any missing for untested scenarios?

---

## Phase 4: Coverage gaps

Synthesize findings from Phases 1–3. Identify missing tests and propose specific new ones.

### 4.1 `workflows/collisions.ts`

- [ ] Assess whether indirect coverage (via health/install/enable) is sufficient, or if dedicated unit tests are needed for edge cases (empty manifests, self-collision, mixed entity types).

### 4.2 `src/mcp/` modules

- [ ] Assess testability. These are MCP tool wrappers — if they're thin pass-throughs to external APIs, unit tests may not add value. If they contain logic (parsing, error handling, retries), they need tests.

### 4.3 Missing scenarios from code review

- [ ] Cross-reference the code review (hugo-review.md) for scenarios that were identified but may lack test coverage — e.g. the 1.4 rollback fix, 1.5 switch rollback, 1.6 single-target update error throw.

### 4.4 Propose and implement new tests

- [ ] Write tests for gaps identified in 4.1–4.3.

---

## Execution

Work through phases in order. Within each phase, items are sequential — read one file, assess, note findings inline, move to the next. Each item gets a verdict: **clean**, **fix** (with specifics), or **add** (missing tests to write).

Current baseline: 314 tests, 0 failures, 748 expect() calls, 18 files, 0 type errors.

## To Do

### Completed

- [x] **1.1** `unit/config.test.ts` — Clean. All 10 exported functions tested with specific assertions. JSONC comment preservation, error paths, and read→mutate→write roundtrips all covered. No dead tests, no missing critical paths.
- [x] **1.2** `unit/sync.test.ts` — Clean. All 3 exported functions tested across every code path (synced/skipped/missing/empty/mixed). Assertions verify both return values and filesystem state. No dead tests.
- [x] **1.3** `unit/bun.test.ts` — `parsePackageSpec` and `getInstalledVersion` were thorough. `packageNameFromSource` (pure function, 2 branches) was untested — added 4 tests: registry with version, registry without version, git throws, file throws. (+4 tests)

- [x] **1.4** `unit/manifest.test.ts` — Clean. All branches in `parseManifest` and internal `parseStringArray` tested: valid inputs (full, partial, empty, null fields), invalid JSON, non-object root, non-array fields, non-string elements, empty strings, duplicates, cross-category same name. 13 tests, no gaps.
- [x] **1.5** `unit/utils.test.ts` — Clean. `stripVersion` (6 tests) and `deriveWorkflowName` (5 tests) cover all branches. Untested functions (`isNodeError`, `errorMessage`, `fileExists`, `getOpencodeDir`) are trivial 1-6 line utilities tested indirectly throughout the suite.
- [x] **2.1** `integration/install.test.ts` — Clean. 19 tests covering full lifecycle: happy path, agents-only, already installed, force reinstall, missing/invalid manifest, rollback on error, all 3 collision types, empty workflow, config preservation, name conflicts, skill sync (synced/skipped/missing dir/no SKILL.md/no skills), and rollback of synced skills.
- [x] **2.2** `integration/remove.test.ts` — Clean. 8 tests: remove enabled, remove disabled, not found error, bun dependency removal, skill unsync (synced removed, skipped kept), no sync state, preserves other workflows.
- [x] **2.3** `integration/update.test.ts` — Clean. 9 tests covering single-target throws on corrupt/missing workflow.json, bulk warns and falls back, version bump with manifest change diffs, skill resync on version bump, new subdirectories in updated skills, workflow not found, no workflows installed.
- [x] **2.4** `integration/enable.test.ts` — Clean. 14 tests: basic enable, multiple, already enabled, mixed, --all, --all all already enabled, --all no workflows, not found, no names, cross-workflow collision, file collision, skill sync on enable, skill already exists warning, config preservation, no-write on no-op.
- [x] **2.5** `integration/disable.test.ts` — Clean. 14 tests mirroring enable: basic disable, multiple, already disabled, mixed, --all variants, errors, skill unsync (synced removed, skipped kept), sync state cleared, no skills, state preservation, no-write on no-op.
- [x] **2.6** `integration/switch.test.ts` — Clean. 12 tests: switch to single/multiple, already active, keeps enabled target, enables disabled target, skill unsync+sync, skill re-sync on switch-back, cross-workflow collision, not found, no workflows, no names, atomic single write.
- [x] **2.7** `integration/list.test.ts` — Clean. 5 tests covering every branch: empty, single, multiple, disabled status, filter by name, not found error.
- [x] **2.8** `integration/health.test.ts` — Clean. 14 tests: healthy single/multiple, cross-workflow collision, file override (agent + command), user config override, scope (no args = enabled only, specific name, --all), cross-check scope with disabled, skill sync awareness (synced not reported, no sync state reported), no workflows, no enabled workflows, enabled status in results.
- [x] **2.9** `integration/build.test.ts` — Clean. 25 tests: full build, agents/commands/skills only, invalid/missing package.json, missing fields warnings, empty dirs, non-.md filtered, skill missing SKILL.md, non-dir in skills filtered, alphabetical sorting, overwrite manifest, valid JSON structure, 8 MCP detection tests (factory, hooks, declared, multi-export, exports field, runtime API warning, no entry point, MCP-only workflow).
- [x] **2.10** `integration/cli.test.ts` — 40 existing tests were thorough across all commands except `update`. `handleUpdate` was the only handler with zero CLI-level testing despite having the most complex output formatting (version arrow, structural change suffix, per-workflow warnings, "all up to date" shortcut). Added 5 tests: bulk all up to date, single target up to date, version bump with structural changes, workflow not found, no workflows installed. (+5 tests)
- [x] **2.11** `integration/e2e.test.ts` — Clean. 2 tests covering both major user flows: consumer lifecycle (install 2 → list → disable → enable → switch → health → remove → verify clean state) and author build flow (create package from scratch → build → verify manifest). All assertions verify exit codes + specific stdout + filesystem state.
- [x] **3.1** `tests/helpers.ts` — Fix. Removed 2 dead helpers: `readFileContent` (thin wrapper, never imported) and `getFileMode` (never imported). Remaining 7 helpers (`createTempDir`, `readConfig`, `fileExists`, `fixtureDir`, `stageFixture`, `swapFixtureVersion`, `runCLI`) are all actively used and correctly implemented. No simplification opportunities.
- [x] **3.2** Fixtures audit — 17/18 fixtures actively used. Deleted orphaned `partial-fail` fixture (designed for partial copy failure testing but never referenced by any test).
- [x] **4.1** `workflows/collisions.ts` — Indirect coverage was strong for agent entity type but missing command/skill paths for cross-workflow collisions and user config overrides. Added 4 direct unit tests in `unit/collisions.test.ts`: cross-workflow collision for commands, cross-workflow collision for skills, user config override for commands, user config override for skills. (+4 tests)
- [x] **4.2** `src/mcp/` modules — `grep_app.ts` and `context7.ts` are pure data (static config objects), not worth testing. `websearch.ts` has 3 branches + 1 error path, `index.ts` has filtering logic. Added 11 tests in `unit/mcp.test.ts`: `createWebsearchConfig` (exa default, exa no key, exa with key, tavily with key, tavily throws without key) and `createBuiltinMcps` (all default, all enabled+remote, disable one, disable multiple, disable all, provider forwarding). Env vars saved/restored per test. (+11 tests)
- [x] **4.3** Cross-reference code review — 1.6 (single-target update throws) already covered by 3 tests. 1.4 (install writeConfig rollback) and 1.5 (switch partial failure rollback) are defensive paths requiring filesystem permission errors to trigger — skipped, rollback logic uses well-tested `syncSkills`/`unsyncSkills`. 1.9 (enable returned entry includes sync state) — added assertion to existing test verifying `result.workflows[0].entry.sync` matches on-disk state. (+1 expect)

- [x] **4.4** Propose and implement new tests — All gaps identified in 4.1–4.3 were addressed inline during each step. No remaining proposals. Final baseline: 314 tests, 0 failures, 748 expect() calls across 18 files.

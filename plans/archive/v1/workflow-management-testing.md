# Testing Plan — Workflow Package Manager

## Strategy

Two layers:

1. **Unit/integration tests** (bun test) — test the modules directly, run in CI, catch regressions.
2. **CLI tests** — test the CLI binary, validating output formatting, exit codes, and argument handling.

Both layers use real filesystem operations and real bun invocations. No mocking bun — it's too central and mocks would hide the bugs we care about.

---

## Fixture Packages

All fixtures live in `tests/fixtures/packages/`. Each is a valid npm package with `package.json` + `hugo-workflow.json` + content files. Installed using `file:` protocol to avoid any registry dependency.

**Important:** Fixtures are read-only templates. Tests that need to mutate a package (e.g., update tests) copy the fixture into a per-test temp directory first and install from there. This prevents cross-test contamination.

### `basic-workflow`

The baseline. Exercises all three content types.

```
basic-workflow/
  package.json              # name: "basic-workflow", version: "1.0.0"
  hugo-workflow.json
  agents/
    reviewer.md
  skills/
    analysis/
      SKILL.md
      scripts/run.sh
  commands/
    review.md
```

Manifest:
```json
{
  "name": "basic-workflow",
  "description": "Test fixture — basic workflow",
  "agents": [{ "path": "agents/reviewer.md" }],
  "skills": [{ "path": "skills/analysis" }],
  "commands": [{ "path": "commands/review.md" }]
}
```

### `agents-only`

Minimal workflow — no skills, no commands. Tests that empty/absent arrays are handled.

```
agents-only/
  package.json              # name: "agents-only", version: "1.0.0"
  hugo-workflow.json
  agents/
    planner.md
    executor.md
```

### `conflict-workflow`

Has an agent with the same filename as `basic-workflow` (`reviewer.md`). Tests cross-workflow conflict detection.

```
conflict-workflow/
  package.json              # name: "conflict-workflow", version: "1.0.0"
  hugo-workflow.json
  agents/
    reviewer.md             # same destination as basic-workflow
```

### `basic-workflow-v2`

Same `name` field in both package.json and hugo-workflow.json as `basic-workflow`, but version `2.0.0` with changes. Used by update tests — copied into the same staging directory to simulate a version bump (see "Update testing approach" below).

Changes from v1:
- `version: "2.0.0"` in package.json
- `agents/reviewer.md` — content changed (triggers file update)
- `commands/review.md` — removed from manifest (triggers file removal)
- `commands/lint.md` — added to manifest (triggers file addition)
- `skills/analysis/scripts/run.sh` — content changed
- `skills/analysis/helpers/format.sh` — new file in existing skill dir

```
basic-workflow-v2/
  package.json              # name: "basic-workflow", version: "2.0.0"
  hugo-workflow.json
  agents/
    reviewer.md             # different content than v1
  skills/
    analysis/
      SKILL.md              # unchanged from v1
      scripts/run.sh        # different content
      helpers/format.sh     # new file
  commands/
    lint.md                 # new command (review.md removed from manifest)
```

### `empty-workflow`

Valid manifest, zero agents/skills/commands. Edge case — nothing to copy.

```
empty-workflow/
  package.json              # name: "empty-workflow", version: "1.0.0"
  hugo-workflow.json        # all arrays empty
```

### `bad-manifest`

Package exists, manifest is invalid.

```
bad-manifest/
  package.json              # name: "bad-manifest", version: "1.0.0"
  hugo-workflow.json        # { "name": "", "description": "test" } — empty name
```

### `no-manifest`

Package exists, no `hugo-workflow.json` at all.

```
no-manifest/
  package.json              # name: "no-manifest", version: "1.0.0"
```

### `partial-fail`

Manifest references a source file that doesn't exist in the package. The first agent copies fine, the second triggers ENOENT mid-loop — exercising the partial-copy cleanup in `syncWorkflow`. More portable than permission-based failure injection (which is flaky on CI / Docker-as-root).

```
partial-fail/
  package.json              # name: "partial-fail", version: "1.0.0"
  hugo-workflow.json        # agents: [{ path: "agents/first.md" }, { path: "agents/ghost.md" }]
  agents/
    first.md                # exists — will be copied before the failure
                            # ghost.md does NOT exist — triggers ENOENT during hashFile/cp
```

---

## Update Testing Approach

Update tests need `bun update` to see a version change. With `file:` protocol, bun reads from the source path — so the source must change, not just node_modules.

**Staging directory pattern:**

1. Each update test creates a temp "source" directory.
2. Copy `basic-workflow` (v1) fixture into it.
3. Install: `install(opencodeDir, "file:<temp-source-dir>")`.
4. Overwrite the temp source dir with `basic-workflow-v2` content.
5. Call `update(opencodeDir)`.
6. `runUpdate` calls `bun update`, which re-reads from the same `file:` path and picks up v2.
7. Our update logic sees the new version and proceeds with the diff.

**Risk:** `bun update` may not re-resolve `file:` deps. This must be validated empirically before writing update tests. Run a manual test:

```bash
# In a temp dir
mkdir source && cp -r fixtures/basic-workflow/* source/
mkdir .opencode && cd .opencode
bun add file:../source
cat node_modules/basic-workflow/package.json  # expect version 1.0.0
cp -r fixtures/basic-workflow-v2/* ../source/
bun update basic-workflow
cat node_modules/basic-workflow/package.json  # expect version 2.0.0
```

**Fallback if bun doesn't re-resolve:** Bypass `bun update` for update tests. Directly overwrite the package content in node_modules (including its package.json version) and call `update()`. This means `runUpdate` runs but is a no-op, and the version change comes from the manual swap. We lose coverage of bun's update behavior specifically, but that's bun's responsibility. Our update logic (version comparison, diff, skip/warn) is fully exercised either way.

**Helper:** `stageFixture(fixtureName)` — copies a fixture into a temp directory and returns the `file:` spec. `swapFixtureVersion(stagingDir, v2FixtureName)` — replaces the staging dir's content with v2.

---

## Layer 1: Unit & Integration Tests

All tests use a fresh temp directory as the `.opencode/` root, cleaned up after each test. Tests call command functions directly (not the CLI binary).

### Module Tests (pure functions, no filesystem)

**`utils.test.ts`** — `stripVersion`
- `"pkg"` → `"pkg"`
- `"pkg@^1.0.0"` → `"pkg"`
- `"@org/pkg"` → `"@org/pkg"`
- `"@org/pkg@^1.0.0"` → `"@org/pkg"`
- `"@org/pkg@latest"` → `"@org/pkg"`

**`manifest.test.ts`** — `parseManifest`
- Valid manifest with all fields → parses correctly
- Missing name → ManifestError
- Empty name (whitespace only) → ManifestError
- Missing description → ManifestError
- Missing agents/skills/commands arrays → defaults to empty arrays
- Agent path without `.md` extension → ManifestError
- Command path without `.md` extension → ManifestError
- Skill path ending in `.md` → ManifestError
- Absolute path → ManifestError
- Path traversal (`../../../etc/passwd`) → ManifestError
- Non-array agents field → ManifestError
- Array item without `path` field → ManifestError

**`bun.test.ts`** — `parsePackageSpec`
- `"some-package"` → registry source
- `"some-package@^1.0.0"` → registry source
- `"@org/pkg"` → registry source
- `"@org/pkg@^2.0.0"` → registry source
- `"github:org/repo"` → git source, no ref
- `"github:org/repo#v1.0.0"` → git source with ref
- `"git+ssh://git@github.com:org/repo.git"` → git source
- `"git+https://github.com/org/repo.git"` → git source
- `"org/repo"` → git source (GitHub shorthand) + warning
- `"org/repo#v1.0.0"` → git source with ref + warning

**`bun.test.ts`** — `packageNameFromSource`
- Registry source `"pkg@^1.0.0"` → `"pkg"`
- Registry source `"@org/pkg@^1.0.0"` → `"@org/pkg"`
- Git source → throws (can't derive before install)

**`state.test.ts`** — `addEntry`, `removeEntry`, `findFileOwner`, `sourceEquals`
- `addEntry` to empty state → state has one entry
- `addEntry` with same name → replaces existing
- `addEntry` with same source, different name → replaces (dedup by source)
- `removeEntry` → entry gone
- `removeEntry` non-existent name → no-op (no crash)
- `findFileOwner` → returns correct entry
- `findFileOwner` for untracked path → returns null
- `sourceEquals` registry same name → true
- `sourceEquals` registry same name different version → true (stripped)
- `sourceEquals` registry different names → false
- `sourceEquals` git same URL → true
- `sourceEquals` git different URL → false
- `sourceEquals` registry vs git → false

### Integration Tests (real filesystem + bun)

Each test creates a fresh temp dir, runs operations, asserts on filesystem state and state.json content.

**`install.test.ts`**

| Test | What it verifies |
|------|-----------------|
| Install basic-workflow | Files copied to correct destinations, state.json has correct entry, hashes match file content |
| Install agents-only | Only agent files copied, no skills/ or commands/ dirs created |
| Install empty-workflow | No files copied, state entry exists with empty files array |
| Install no-manifest package | Throws with clear error about missing hugo-workflow.json |
| Install bad-manifest package | Throws ManifestError with specific validation failure |
| Install same package twice (clean) | Second install overwrites clean files, state entry updated with new syncedAt |
| Install same package twice (modified) | Modify a file between installs. Verify modified file is skipped with warning on reinstall. |
| Install with file conflict (unmanaged) | Pre-create agents/reviewer.md before install. Verify it's skipped with warning, not overwritten. |
| Install two workflows that conflict | Install basic-workflow, then conflict-workflow. Second throws "already exists from workflow" error. |
| Partial failure cleanup | Install partial-fail fixture. Verify agents/first.md (copied before error) is cleaned up. Verify state.json doesn't contain the failed workflow. Verify bun dep is rolled back. |
| Reinstall after partial failure | Run the partial failure scenario, then install basic-workflow. Verify clean install succeeds — no orphan files blocking it. |
| File permissions preserved | Install basic-workflow. Verify skills/analysis/scripts/run.sh retains executable permission from the source fixture. |

**`update.test.ts`**

Uses the staging directory pattern described above. Each test stages v1, installs, stages v2, updates.

| Test | What it verifies |
|------|-----------------|
| Update detects version change | Updated files are overwritten, new files added, removed files deleted. State reflects v2. |
| Update with no version change | Reports "already up to date", no files touched |
| Update skips locally modified files | Modify agents/reviewer.md before update. Verify it's skipped, reported in skipped[], old hash preserved in state. |
| Update skips locally deleted files | Delete agents/reviewer.md before update. Verify it's skipped (not re-created), reported in skipped[]. |
| Update removes files dropped from manifest | commands/review.md in v1 but not v2. Verify it's deleted and absent from state. |
| Update keeps modified file that was removed from manifest | Modify commands/review.md, then update to v2 (which drops it). Verify file kept, reported in skipped. |
| Update adds new files | commands/lint.md and skills/analysis/helpers/format.sh are new in v2. Verify created with correct hashes. |
| Update cleans empty skill dirs | If update removes all files from a skill subdirectory, verify empty dir is cleaned up. |
| Update idempotency | Run update twice in a row after staging v2. Second run reports "already up to date". State.json is byte-identical after the second run (no timestamp churn, no phantom changes). |
| Update with nothing installed | Throws "No workflows installed" |

**`remove.test.ts`**

| Test | What it verifies |
|------|-----------------|
| Remove installed workflow | All files deleted, state entry gone, empty skill dirs cleaned, bun dep removed from package.json |
| Remove with locally modified file | Modified file left in place, reported in keptFiles. Other clean files deleted. State entry still removed. |
| Remove with all files modified | All files kept. State entry removed. bun dep removed. |
| Remove with already-deleted file | No error thrown, counts as removed. |
| Remove non-existent workflow | Throws "not installed" error |

**`status.test.ts`**

| Test | What it verifies |
|------|-----------------|
| Status of clean install | All files show "clean" |
| Status after modifying a file | That file shows "modified", others show "clean" |
| Status after deleting a file | That file shows "deleted", others show "clean" |
| Status for specific workflow name | Only that workflow reported |
| Status for non-existent name | Throws error |

**`state.test.ts` (integration — filesystem)**

| Test | What it verifies |
|------|-----------------|
| Read from non-existent file | Returns `{ workflows: [] }` |
| Write then read round-trip | State survives serialization exactly |
| Read corrupted JSON | Throws StateError |
| Read valid JSON, missing workflows key | Throws StateError |
| Read state with extra unknown fields | Doesn't throw — extra fields silently ignored |

**`integrity.test.ts`**

| Test | What it verifies |
|------|-----------------|
| All files unchanged | All "clean" |
| One file modified | That file "modified" |
| One file deleted | That file "deleted" |
| All files deleted | All "deleted" |

**`sync.test.ts`**

| Test | What it verifies |
|------|-----------------|
| collectManifestPaths maps agents/commands/skills correctly | Correct source→destination pairs |
| collectManifestPaths with non-existent skill dir | Throws with helpful message (not raw ENOENT) |
| walkDir skips dotfiles and node_modules | Only real content files returned |
| walkDir on empty directory | Returns empty array |
| cleanEmptySkillDirs removes empty dirs | Bottom-up cleanup works |
| cleanEmptySkillDirs leaves non-empty dirs | Dirs with remaining files untouched |
| cleanEmptySkillDirs with empty input | No-op, no crash |

### Fresh project tests

These verify behavior when `.opencode/` doesn't exist at all (first-time user).

| Test | What it verifies |
|------|-----------------|
| `list()` with no .opencode dir | Returns empty workflows list (no crash) |
| `status()` with no .opencode dir | Returns empty workflows list |
| `update()` with no .opencode dir | Throws "No workflows installed" |
| `remove()` with no .opencode dir | Throws "not installed" |
| `install()` with no .opencode dir | Creates .opencode/, installs successfully |

---

## Layer 2: CLI Tests

These test the CLI binary (`bun dist/cli.js`) specifically for concerns that integration tests don't cover: output formatting, exit codes, argument parsing, and the help text. They do NOT re-test business logic already covered by integration tests.

Run via `Bun.spawn` or `$` shell in bun test files, asserting on stdout, stderr, and exit codes.

### Argument handling

| Test | What it verifies |
|------|-----------------|
| `hugo --help` | Prints help text, exit 0 |
| `hugo` (no args) | Prints help text, exit 0 |
| `hugo unknowncommand` | Prints "Unknown command", exit 1 |
| `hugo install` (no package) | Error "missing package spec", exit 1 |
| `hugo remove` (no name) | Error "missing workflow name", exit 1 |

### Output formatting

| Test | What it verifies |
|------|-----------------|
| Install success output | Contains workflow name, version, counts in expected format |
| Install warning output | Warnings printed with `⚠` prefix before success message |
| List output (with workflows) | "Installed workflows:" header, each entry on its own line |
| List output (empty) | "No workflows installed." |
| Status output (clean) | Shows clean/modified/deleted counts |
| Status output (with issues) | Modified and deleted files listed individually |
| Remove output | "Removed workflow" message with file counts |
| Remove output (kept files) | "Leaving <file> — locally modified" warnings before summary |
| Error output | All errors formatted as "Error: <message>", printed to stderr |

### Exit codes

| Test | What it verifies |
|------|-----------------|
| Successful commands | Exit 0 for install, list, status, remove, update |
| Failed commands | Exit 1 for all error paths |

---

## Test Utilities

Shared helpers in `tests/helpers.ts`:

- `createTempDir()` → creates a temp directory, returns path + cleanup function
- `readState(opencodeDir)` → reads and returns parsed state.json (or null if missing)
- `fileExists(path)` → boolean
- `readFileContent(path)` → string
- `fixtureDir(name)` → resolves absolute path to a fixture in `tests/fixtures/packages/`
- `stageFixture(fixtureName)` → copies a fixture into a temp dir, returns `{ dir, spec }` where spec is `file:<dir>`. For update tests.
- `swapFixtureVersion(stagingDir, v2FixtureName)` → replaces staging dir content with the v2 fixture
- `runCLI(args, options?)` → runs `bun dist/cli.js <args>` in a given cwd, returns `{ stdout, stderr, exitCode }`. Has a default timeout (10s) to prevent hung tests if bun spawns go sideways.

---

## Execution Order

1. Validate `bun update` + `file:` protocol behavior (manual, one-time)
2. Create fixture packages
3. Write test utilities
4. Unit tests (pure functions — fast, no IO)
5. Integration tests (filesystem + bun — the bulk of the value)
6. CLI tests (output and exit codes)

Step 1 is a blocker for update tests. If `bun update` doesn't re-resolve `file:` deps, switch to the fallback approach (direct node_modules swap) before writing update tests.

---

## Known Limitations (Not Tested)

- **Concurrent writes.** Two `hugo install` processes racing on state.json could corrupt it. Hugo is a single-user CLI — this is unlikely in practice. Not worth a flaky race-condition test. Documented here as a known gap.
- **Symlinks in skill directories.** `walkDir` follows symlinks via `isDirectory()`. A circular symlink would cause infinite recursion. Unlikely in npm packages. If it becomes a concern, add a depth guard to `walkDir` — that's a code change, not a test.
- **Deep nesting / path length.** No smoke test for deeply nested skill directories. Low risk — OS-level limits would surface as clear errors.

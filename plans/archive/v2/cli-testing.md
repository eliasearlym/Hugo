# CLI Testing Plan — Real-World Demo Repo

## Purpose

Run every Hugo CLI command against a **real demo repo** (not temp dirs, not mocked fixtures). This validates the full end-to-end flow: bun dependency management, opencode.json state mutations, collision detection, .opencode/ filesystem interactions — all in a single, persistent project directory that accumulates state across tests.

The existing test suite (232 passing) uses temp dirs with `file:` fixture packages. This plan exercises the CLI in a way that's closer to how a real user would use it — sequentially, against a repo that carries forward state from each prior step.

---

## Prerequisites

1. **Build the CLI**: `bun run build` (already done — `dist/cli.js` exists)
2. **Create a demo repo**: A fresh directory with a minimal `opencode.json`
3. **Create 3 real workflow packages**: Local packages with realistic agents, commands, and skills that exercise collision detection
4. **Have `bun` available**: The CLI shells out to `bun add` / `bun remove` / `bun update`

---

## Directory Layout

Everything lives **one level above the Hugo project** to keep test artifacts completely separate from the source repo:

```
Happily-Dev/
  Hugo/                              ← the project (untouched)
  hugo-cli-test/                     ← all test artifacts live here
    demo-repo/                       ← the demo "project" Hugo operates on
      opencode.json
    packages/                        ← workflow packages used as install sources
      demo-code-review/
      demo-code-review-v2/
      demo-debugging/
      demo-security/
```

**Base path:** `/Users/elias/Desktop/main/workspace/git/repositories/Happily-Dev/hugo-cli-test`

All `hugo` commands run with `cwd` set to `hugo-cli-test/demo-repo/`.
All `file:` install specs point to `hugo-cli-test/packages/<name>`.

---

## Demo Repo Setup

Create `hugo-cli-test/demo-repo/` with:

```
demo-repo/
  opencode.json       →  { "$schema": "https://opencode.ai/config.json" }
```

No `.opencode/` directory — Hugo should create it on first install.

---

## Workflow Packages to Create

All packages live under `hugo-cli-test/packages/`.

Three local workflow packages, designed to create specific collision scenarios:

### Package A: `@demo/code-review` (v1.0.0)
```
packages/demo-code-review/
  package.json       →  { "name": "@demo/code-review", "version": "1.0.0", "description": "Code review workflow" }
  workflow.json      →  { "agents": ["reviewer", "summarizer"], "commands": ["review", "diff-check"], "skills": ["code-analysis"] }
  agents/
    reviewer.md
    summarizer.md
  commands/
    review.md
    diff-check.md
  skills/
    code-analysis/
      SKILL.md
```

### Package B: `@demo/debugging` (v1.0.0)
```
packages/demo-debugging/
  package.json       →  { "name": "@demo/debugging", "version": "1.0.0", "description": "Debugging workflow" }
  workflow.json      →  { "agents": ["debugger", "tracer"], "commands": ["debug", "trace"], "skills": ["error-analysis"] }
  agents/
    debugger.md
    tracer.md
  commands/
    debug.md
    trace.md
  skills/
    error-analysis/
      SKILL.md
```

### Package C: `@demo/security` (v1.0.0) — designed to COLLIDE with Package A
```
packages/demo-security/
  package.json       →  { "name": "@demo/security", "version": "1.0.0", "description": "Security audit workflow" }
  workflow.json      →  { "agents": ["reviewer", "scanner"], "commands": ["audit"], "skills": ["code-analysis"] }
  agents/
    reviewer.md       ← same name as Package A's agent
    scanner.md
  commands/
    audit.md
  skills/
    code-analysis/    ← same name as Package A's skill
      SKILL.md
```

### Package A v2: `@demo/code-review` (v2.0.0) — for update testing
```
packages/demo-code-review-v2/
  package.json       →  { "name": "@demo/code-review", "version": "2.0.0", "description": "Code review workflow v2" }
  workflow.json      →  { "agents": ["reviewer", "summarizer", "architect"], "commands": ["review"], "skills": ["code-analysis"] }
```
Changes from v1: adds agent "architect", removes command "diff-check". Version bumps to 2.0.0.

---

## Test Sequence

All commands run from `hugo-cli-test/demo-repo/`. Hugo binary: `bun /Users/elias/Desktop/main/workspace/git/repositories/Happily-Dev/Hugo/dist/cli.js`.

Shorthand in tables below:
- `hugo <args>` = `bun <Hugo>/dist/cli.js <args>` (cwd = `demo-repo/`)
- `<packages>/` = `hugo-cli-test/packages/`

### Phase 1: Clean State Baseline

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 1.1 | `hugo list` | "No workflows installed." | stdout |
| 1.2 | `hugo health` | "No workflows installed." (throws — no workflows exist) | exit code 1 |
| 1.3 | `hugo --help` | Prints help text | exit code 0 |
| 1.4 | `hugo` | Prints help text (no command = help) | exit code 0 |
| 1.5 | `hugo bogus` | "Error: unknown command "bogus"" | exit code 1 |
| 1.6 | `hugo install` | "Error: missing package spec" | exit code 1 |
| 1.7 | `hugo remove` | "Error: missing workflow name" | exit code 1 |
| 1.8 | `hugo enable` | "Error: missing workflow name" | exit code 1 |
| 1.9 | `hugo disable` | "Error: missing workflow name" | exit code 1 |
| 1.10 | `hugo switch` | "Error: missing workflow name" | exit code 1 |
| 1.11 | `hugo install --forse` | "Error: unknown flag "--forse"" (typo guard) | exit code 1 |

### Phase 2: Install

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 2.1 | `hugo install file:<packages>/demo-code-review` | Installs, prints `Installed "code-review" v1.0.0 (2 agents, 2 commands, 1 skill)` | stdout, exit 0 |
| 2.2 | Inspect `opencode.json` | `plugin` array contains `"@demo/code-review"`. `hugo.workflows.code-review` has correct metadata. | file content |
| 2.3 | Inspect `.opencode/node_modules/@demo/code-review/` | Directory exists with `package.json`, `workflow.json` | filesystem |
| 2.4 | `hugo install file:<packages>/demo-code-review` (duplicate) | "Error: "code-review" is already installed. Use --force to reinstall." | exit code 1 |
| 2.5 | `hugo install --force file:<packages>/demo-code-review` | Reinstalls successfully | exit code 0 |
| 2.6 | `hugo i file:<packages>/demo-debugging` (alias) | Installs debugging workflow | stdout, exit 0 |
| 2.7 | Inspect `opencode.json` | Both plugins in `plugin` array. Both workflow entries in `hugo.workflows`. | file content |

### Phase 3: Install with Collisions

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 3.1 | `hugo install file:<packages>/demo-security` | Installs BUT prints collision warnings: agent "reviewer" conflicts with code-review, skill "code-analysis" conflicts with code-review | stdout contains ⚠, exit 0 |
| 3.2 | Count collision warnings | Exactly 2 warnings (agent "reviewer", skill "code-analysis") | stdout parsing |

### Phase 4: List & Inspect

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 4.1 | `hugo list` | Shows all 3 workflows, all `(enabled)` | stdout |
| 4.2 | `hugo ls` (alias) | Same output as `hugo list` | stdout |
| 4.3 | `hugo list code-review` | Shows only code-review with agents/commands/skills details | stdout |
| 4.4 | `hugo list nonexistent` | "Error: Workflow "nonexistent" is not installed." | exit code 1 |

### Phase 5: Disable / Enable

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 5.1 | `hugo disable code-review` | `Disabled "code-review"` | stdout, exit 0 |
| 5.2 | `hugo list code-review` | Shows `(disabled)` | stdout |
| 5.3 | Inspect `opencode.json` | `@demo/code-review` NOT in `plugin` array. Still in `hugo.workflows`. | file content |
| 5.4 | `hugo disable code-review` (again) | `"code-review" is already disabled.` | stdout, exit 0 |
| 5.5 | `hugo enable code-review` | `Enabled "code-review"` (with collision warnings against security) | stdout, exit 0, warnings present |
| 5.6 | `hugo enable code-review` (again) | `"code-review" is already enabled.` | stdout, exit 0 |
| 5.7 | `hugo disable --all` | Disables all 3 workflows | stdout, exit 0 |
| 5.8 | `hugo list` | All 3 show `(disabled)` | stdout |
| 5.9 | `hugo disable --all` (again) | "All workflows are already disabled." | stdout, exit 0 |
| 5.10 | `hugo enable --all` | Enables all 3 (with collision warnings) | stdout, exit 0 |
| 5.11 | `hugo enable --all` (again) | "All workflows are already enabled." | stdout, exit 0 |

### Phase 6: Switch

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 6.1 | `hugo switch debugging` | Switches to debugging only. Disables code-review and security. | stdout shows "Switched to", "disabled:" |
| 6.2 | `hugo list` | Only debugging is `(enabled)`, others `(disabled)` | stdout |
| 6.3 | `hugo switch code-review security` | Switches to both. Disables debugging. Shows collision warnings. | stdout |
| 6.4 | `hugo switch code-review security` (again, same state) | "Already active: code-review, security." | stdout, exit 0 |
| 6.5 | `hugo switch nonexistent` | "Error: Workflow "nonexistent" is not installed." | exit code 1 |

### Phase 7: Health

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 7.1 | `hugo switch code-review` | Set up: only code-review enabled | |
| 7.2 | `hugo health` | "All workflows healthy." (no collisions with only 1 enabled) | stdout, exit 0 |
| 7.3 | `hugo enable security` | Enable the conflicting workflow | |
| 7.4 | `hugo health` | Reports collisions: reviewer + code-analysis conflict between code-review and security | stdout |
| 7.5 | `hugo health code-review` | Shows collision report for code-review specifically | stdout |
| 7.6 | `hugo health --all` | Shows all 3 workflows with enabled/disabled status and all collision data | stdout |
| 7.7 | `hugo health nonexistent` | "Error: Workflow "nonexistent" is not installed." | exit code 1 |

### Phase 8: File Override Detection

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 8.1 | Create `.opencode/agents/reviewer.md` in demo repo | Manual override file | filesystem |
| 8.2 | `hugo health code-review` | Reports "overridden-by-file" warning for agent "reviewer" in addition to cross-workflow collision | stdout |
| 8.3 | Remove `.opencode/agents/reviewer.md` | Clean up | |

### Phase 9: User Config Override Detection

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 9.1 | Add `"agent": { "reviewer": { ... } }` to `opencode.json` | Manual config override | file |
| 9.2 | `hugo health code-review` | Reports "overridden-by-user-config" warning for agent "reviewer" | stdout |
| 9.3 | Remove the agent key from `opencode.json` | Clean up | |

### Phase 10: Update

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 10.1 | Set up: replace `<packages>/demo-code-review` contents with `demo-code-review-v2` | Swap the local package files to v2.0.0 | filesystem |
| 10.2 | `hugo update code-review` | Reports: Updated "code-review" v1.0.0 → v2.0.0, added agent: architect, removed command: diff-check | stdout |
| 10.3 | Inspect `opencode.json` | `hugo.workflows.code-review.version` is "2.0.0", agents include "architect", commands no longer include "diff-check" | file content |
| 10.4 | `hugo update code-review` (again, no change) | `"code-review" already up to date.` | stdout |
| 10.5 | `hugo update` (all) | Reports all workflows up to date (debugging and security haven't changed) | stdout |

### Phase 11: Remove

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 11.1 | `hugo remove security` | `Removed "security"` with counts | stdout, exit 0 |
| 11.2 | Inspect `opencode.json` | No security in plugin array or hugo.workflows | file content |
| 11.3 | `hugo rm debugging` (alias) | `Removed "debugging"` | stdout, exit 0 |
| 11.4 | `hugo remove code-review` | `Removed "code-review"` | stdout, exit 0 |
| 11.5 | `hugo list` | "No workflows installed." | stdout |
| 11.6 | `hugo remove nonexistent` | "Error: Workflow "nonexistent" is not installed." | exit code 1 |

### Phase 12: Build (Workflow Authoring)

Run with `cwd` set to one of the `<packages>/` directories, not the demo repo.

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 12.1 | `hugo build` (cwd = `<packages>/demo-code-review`) | `Built workflow.json (2 agents, 2 commands, 1 skill)` | stdout, exit 0 |
| 12.2 | Inspect `workflow.json` | Contains correct agents, commands, skills arrays | file content |
| 12.3 | `hugo build` (from empty dir, no agents/commands/skills) | "Error: No agents, commands, or skills found." | exit code 1 |
| 12.4 | `hugo build` (from dir with no package.json) | "Error: No package.json found." | exit code 1 |
| 12.5 | Create a skills dir with a subdirectory missing SKILL.md | `hugo build` should warn about skipped skill directory | stdout contains "Warning:" |

### Phase 13: Edge Cases

| # | Command | Expected Behavior | Verify |
|---|---------|-------------------|--------|
| 13.1 | `hugo install file:<packages>/no-manifest-pkg` (create a package dir with no workflow.json) | "Error: ... is not a workflow package (missing workflow.json)." | exit code 1 |
| 13.2 | `hugo install file:<packages>/bad-manifest-pkg` (create a package dir with invalid workflow.json) | "Error: ... has an invalid workflow.json: ..." | exit code 1 |
| 13.3 | `hugo enable nonexistent` | "Error: Workflow "nonexistent" is not installed." | exit code 1 |
| 13.4 | `hugo disable nonexistent` | "Error: Workflow "nonexistent" is not installed." | exit code 1 |
| 13.5 | `hugo install extra1 extra2` | "Warning: ignoring extra arguments: extra2" (only first arg used as spec) | stdout or stderr |
| 13.6 | `hugo remove name1 name2` | "Warning: ignoring extra arguments: name2" | stdout or stderr |

---

## Execution Approach

Two options — pick one:

### Option A: Manual Sequential Execution
Run each command manually via `bun <Hugo>/dist/cli.js` from `hugo-cli-test/demo-repo/`, inspect output and files after each step. Best for a first pass and debugging.

### Option B: Scripted Sequential Execution
Write a bash script or Bun script that runs the entire sequence, captures stdout/stderr/exit codes, and asserts expected values. More repeatable but more upfront work.

**Recommendation:** Start with Option A for the first pass. If we want repeatability, convert to a script afterward — but the existing `bun test` suite with 232 tests already covers most edge cases in isolation. The value of this plan is the sequential, stateful, real-world flow.

### Cleanup
Delete `hugo-cli-test/` when done. Nothing inside the Hugo project is modified.

---

## What This Tests That Unit/Integration Tests Don't

1. **Cumulative state** — install A, install B, install C, then check health. The test suite creates fresh temp dirs for each test.
2. **Real `bun add` / `bun remove`** — the integration tests use `file:` fixtures in temp dirs, but this uses a persistent `.opencode/` directory that accumulates real node_modules state.
3. **CLI output formatting** — the test suite checks for substrings; manual execution lets you eyeball the full output for formatting issues, alignment, etc.
4. **Flag rejection** — typo guards like `--forse` are easy to miss in automated tests.
5. **Collision accumulation** — installing a third package that collides with the first, while the second is neutral, tests the cross-workflow detection in a more realistic scenario.
6. **File override and config override detection** — creating real `.opencode/agents/` files and adding real `agent.*` keys to opencode.json, then checking health against them.
7. **Update with manifest changes** — swapping a local package's files to simulate a version bump and verifying Hugo detects added/removed agents/commands/skills.

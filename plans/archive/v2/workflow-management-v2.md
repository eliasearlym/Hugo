# Workflow Management v2 — Plugin-Based Approach

## Why v2

v1 copied workflow files (agents, skills, commands) from `node_modules/` into `.opencode/agents/`, `.opencode/skills/`, `.opencode/commands/`. This created a class of problems that are inherent to file copying in a shared flat namespace:

- **Naming collisions** — two workflows defining `agents/reviewer.md` can't coexist
- **Silent incomplete installs** — skipped files aren't tracked in state; `hugo status` reports clean when the workflow is actually missing files
- **Orphaned files** — `hugo remove` keeps modified files, which become unmanaged blockers for future installs
- **Integrity tracking overhead** — SHA-256 hashing, conflict detection, rollback logic, partial-copy cleanup
- **User file safety** — any bug in the sync layer could overwrite or delete user-created files

v2 eliminates file copying entirely. Workflow packages are OpenCode plugins. Hugo manages the `plugin` array in `opencode.json` — adding and removing workflow package names. Each workflow plugin handles its own agent, command, skill, and MCP registration through OpenCode's plugin API. Hugo is a package manager, not a config generator.

## How It Works

### OpenCode's Plugin System

OpenCode plugins are npm packages listed in the `plugin` array in `opencode.json`:

```json
{
  "plugin": ["@org/code-review", "@org/debugging"]
}
```

Plugins are JavaScript/TypeScript modules that export a plugin function. They receive a context object and return hooks — including a `config` hook that can modify the OpenCode config at runtime:

```typescript
export const CodeReviewWorkflow: Plugin = async (ctx) => {
  return {
    config: async (config) => {
      // Register agents, commands, skills, MCPs, etc.
      config.agent = { ...config.agent, reviewer: { /* ... */ } };
      config.command = { ...config.command, review: { /* ... */ } };
      config.mcp = { ...config.mcp, /* ... */ };
    },
  };
};
```

OpenCode handles all discovery and loading. The plugin decides what to register.

### Hugo's Role

Hugo is a package manager for workflow plugins. It:

1. Installs/removes/updates packages via bun
2. Adds/removes package names from the `plugin` array in `opencode.json`
3. Tracks workflow state (installed, enabled/disabled, version, what it provides)
4. Detects collisions across workflows by reading manifests
5. Provides build tooling for workflow authors

Hugo does **not** parse agent/command `.md` files, write `agent.*` or `command.*` config entries, or manage skills paths. That's the workflow plugin's job.

### Config Precedence

OpenCode's config sources (later wins):

| Priority | Source | Description |
|----------|--------|-------------|
| 1 | Remote | Remote/shared config |
| 2 | Global | `~/.config/opencode/config.json` |
| 3 | Custom | Custom config file |
| 4 | Project `opencode.json` | **Where Hugo manages the `plugin` array** |
| 5 | `.opencode/` directories | File-based agents/commands/skills/plugins |
| 6 | Inline | Inline config overrides |

Plugins loaded from the `plugin` array modify the config during load. User files in `.opencode/agents/` (priority 5) can still override what plugins register. User customization always wins.

## Architecture Overview

```
hugo install <package>
  1. bun add <package> --cwd .opencode/   ← install to .opencode/node_modules/ (Hugo's working copy)
  2. Read workflow.json manifest           ← validate it's a workflow package
  3. Collision detection                   ← cross-workflow name collisions via manifests
  4. Add package to plugin array           ← OpenCode auto-installs to its cache and loads it on next startup
  5. Write Hugo state                      ← track workflow in hugo.workflows
  6. Return result
```

### What changes from v1

| Component | v1 | v2 |
|-----------|----|----|
| **Install** | bun add → copy files → hash → write state.json | bun add → read manifest → add to plugin array → write hugo state |
| **Remove** | integrity check → delete files → clean dirs → bun remove → write state.json | remove from plugin array → remove hugo state → bun remove |
| **Update** | bun update → diff manifests → copy/delete files → write state.json | bun update → re-read manifest → update hugo state |
| **List** | Read state.json, count files by directory prefix | Read hugo state + manifests, show details + enabled/disabled status |
| **Enable/Disable** | N/A | Add/remove package name from plugin array |
| **Switch** | N/A | Disable all, enable only specified |
| **Health** | N/A | Read manifests, check cross-workflow collisions + user overrides |
| **State** | `state.json` — files array with source/destination/hash | `opencode.json` `hugo` key — workflow entries + `plugin` array |

### What's eliminated (vs original v2 plan)

Everything from v1, plus:

- All frontmatter/YAML parsing — workflow plugins handle their own registration
- `agent.*`, `command.*`, `skills.paths` config management — not Hugo's concern
- `ParsedAgent`, `ParsedCommand`, `ParsedWorkflowPackage` types
- `parseWorkflowPackage` function — manifest reading is sufficient
- `yaml` dependency — not needed
- `findAgentOwner`, `findCommandOwner` — Hugo doesn't own config entries

### What's preserved

- `bun.ts` — package management (addDependency, removeDependency, runUpdate, parsePackageSpec, getInstalledVersion, getPackageDir) — enhanced with `installPackage`
- `manifest.ts` — parseManifest, ManifestError — reads and validates `workflow.json`
- `utils.ts` — stripVersion
- `cli.ts` — parseArgs pattern, command routing structure
- `index.ts` — OpenCode plugin entry (unchanged)

## Detailed Design

### 1. Workflow Name Derivation

The workflow name is the key in `hugo.workflows` and is what users pass to all commands after install. It's derived from the npm package name by stripping the scope:

- `@org/code-review` → `code-review`
- `code-review` → `code-review`
- `@org/my-workflow-plugin` → `my-workflow-plugin`

For git and file sources, the package name is resolved after `bun add` (via dep-diffing in `installPackage`), then the same rule applies.

If the derived name collides with an already-installed workflow (from a different package), install errors: `Workflow name "code-review" conflicts with already-installed workflow from package "@other-org/code-review".` This is distinct from agent/command naming collisions (which warn) — workflow name collisions are a hard error because the name is Hugo's primary key.

Implementation: `deriveWorkflowName(packageName: string) → string` in `utils.ts`.

### 2. Single Source of Truth — `opencode.json`

Hugo manages two areas of `opencode.json`:

1. **`plugin` array** — workflow package names (OpenCode's standard plugin config)
2. **`hugo` key** — Hugo's own state (workflow tracking, metadata)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@org/code-review"],
  "hugo": {
    "workflows": {
      "code-review": {
        "package": "@org/code-review",
        "version": "1.0.0",
        "agents": ["reviewer"],
        "commands": ["review"],
        "skills": ["analysis"]
      },
      "debugging": {
        "package": "@org/debugging",
        "version": "2.1.0",
        "agents": ["debugger"],
        "commands": [],
        "skills": []
      }
    }
  }
}
```

Enabled/disabled is derived from the `plugin` array — not stored in Hugo state. `@org/code-review` is in the `plugin` array, so it's enabled. `@org/debugging` is not, so it's disabled. OpenCode only loads plugins listed in the array.

Hugo state caches `version`, `agents`, `commands`, and `skills` from the installed package so `hugo list` and `hugo health` don't need to read from `node_modules/` every time. These are refreshed on install and update.

**Benefits:**
- One file to read, one file to write, no sync between multiple files
- Hugo only touches `plugin` and `hugo` — everything else is untouched
- User can see everything Hugo manages by looking at one file
- Hugo's state is version-controlled alongside the config
- Enabled/disabled is just presence/absence in the `plugin` array — single source of truth, no redundant flag
- Workflow plugins get the full OpenCode plugin API — agents, commands, MCPs, custom tools, event hooks

### 3. Manifest Schema

The manifest (`workflow.json`) is metadata for Hugo's tracking. It lists what the workflow provides so Hugo can display details and detect collisions without understanding the plugin's internals.

```json
{
  "agents": ["reviewer", "linter"],
  "commands": ["review"],
  "skills": ["analysis"]
}
```

Name and description come from `package.json` — not duplicated in the manifest.

The manifest is generated by `hugo build`, not written by hand.

**Directory structure for workflow packages:**
```
my-workflow/
  package.json              ← name, description, main points to plugin entry
  workflow.json             ← generated by hugo build
  src/
    index.ts                ← plugin entry point (written by workflow author)
  agents/
    reviewer.md             ← agent definition (plugin parses and registers via config hook)
    linter.md
  commands/
    review.md               ← command definition (plugin parses and registers via config hook)
  skills/
    analysis/
      SKILL.md
      scripts/run.sh        ← supporting files
```

### 4. Manifest Parsing — `manifest.ts`

`manifest.ts` reads and validates `workflow.json`. This is the only thing Hugo needs from the package — it doesn't read `.md` files or parse frontmatter.

```ts
parseManifest(jsonContent: string) → WorkflowManifest
```

Validates:
- Valid JSON
- `agents`, `commands`, `skills` are string arrays (optional, default to `[]`)
- No empty strings in arrays
- No duplicate names within a category

The manifest is intentionally minimal. Hugo doesn't validate that the listed agents/commands/skills actually exist as files — that's the workflow author's responsibility (and `hugo build` catches it at authoring time).

### 5. Config Management — `src/workflows/config.ts`

Single module for all `opencode.json` operations.

```
readConfig(projectDir: string) → Record<string, unknown>
writeConfig(projectDir: string, config: Record<string, unknown>) → void

// Plugin array management
addPlugin(config, packageName) → config
removePlugin(config, packageName) → config
hasPlugin(config, packageName) → boolean
getPlugins(config) → string[]

// Hugo state (stored under config.hugo)
getWorkflows(config) → Record<string, WorkflowEntry>
getWorkflow(config, name) → WorkflowEntry | undefined
setWorkflow(config, name, entry) → config
removeWorkflow(config, name) → config
```

**Critical requirement:** Hugo preserves all existing config — user's theme, keybinds, MCP servers, provider settings, agents, commands, etc. It only touches the `plugin` array and the `hugo` key.

**First run:** If `opencode.json` doesn't exist, `readConfig` returns `{}`. On first `writeConfig`, Hugo creates the file. The minimal created file will contain only `plugin` and `hugo` keys — no `$schema` or other boilerplate. Users who want `$schema` can add it themselves or use `opencode init`.

**Config format:** OpenCode supports JSONC (JSON with comments). Hugo reads with `jsonc-parser` and writes with standard JSON. Comment stripping is a known limitation.

### 6. Package Installation — `bun.ts`

#### Where packages live

Hugo installs workflow packages to `.opencode/node_modules/` (via `bun add --cwd .opencode/`). This is Hugo's working copy — used for manifest reading, version checking, and metadata caching. Hugo creates `.opencode/package.json` if it doesn't exist.

OpenCode **separately** auto-installs plugins to `~/.cache/opencode/node_modules/` at startup. When a package name is in the `plugin` array, OpenCode handles its own installation. The two copies serve different purposes:

- `.opencode/node_modules/` — Hugo's install-time data (manifest, version, package.json)
- `~/.cache/opencode/node_modules/` — OpenCode's runtime copy (what actually loads the plugin)

This duplication is intentional and acceptable. Hugo needs manifest data at install time, before OpenCode has started. OpenCode needs its own managed copy for runtime loading. The `.opencode/` directory is version-controlled (or gitignored — user's choice), so `hugo list` and `hugo health` work without OpenCode running.

`bun remove` also runs against `.opencode/` to clean up Hugo's copy. OpenCode's cache is managed by OpenCode.

#### Bun failure handling

All bun operations (`bun add`, `bun remove`, `bun update`) can fail: package not found, network error, git clone failure, permission error, etc.

Hugo's approach:
1. Run bun with `.quiet()` to suppress normal output
2. If the process exits non-zero, capture stderr
3. Report a clean error: `Error: Failed to install "@org/bad-package": <bun's error message>`
4. Exit 1 — no rollback needed if bun itself failed (nothing was installed)

For `bun update` with multiple packages, bun handles all-or-nothing atomicity. If `bun update` fails, Hugo reports the error and makes no state changes.

For `bun remove` failures (rare — package not in dependencies), Hugo logs a warning but continues with state cleanup. The goal of remove is to clean up Hugo's tracking — if the bun package is already gone, that's fine.

#### installPackage

The dep-diffing logic moves into `installPackage`:

```ts
installPackage(opencodeDir: string, spec: string) → {
  packageName: string,
  packageDir: string,
  source: PackageSource
}
```

Encapsulates: snapshot deps → `bun add` → resolve package name → return result.

### 7. Collision Detection

Collisions are detected by reading manifests from all installed workflows. All collision scenarios **warn and continue** — they never block installation.

**On install/enable:**

1. Read manifests from all installed workflows in `.opencode/node_modules/`
2. For each agent/command/skill name the new workflow declares:
   - Check if another enabled workflow declares the same name → **warn:** `Agent "reviewer" is also provided by workflow "other-workflow".`
   - Check if `.opencode/agents/<name>.md` exists → **warn:** `.opencode/agents/reviewer.md` will override workflow version.`
   - Check if `agent.<name>` exists in `opencode.json` (user-defined, not from a plugin) → **warn:** `Agent "reviewer" is defined in opencode.json — may conflict with workflow version.`
3. Same checks for commands and skills

**Key difference from original v2 plan:** Collisions are detected via manifest cross-referencing, not config-key ownership tracking. Hugo doesn't own config entries — it owns the `plugin` array and reads manifests for collision data.

### 8. Command Flows

#### Install

```
1. parsePackageSpec(spec)
2. Check if workflow already installed (in hugo.workflows) → error (unless --force)
3. installPackage(opencodeDir, spec) → { packageName, packageDir, source }
4. Read workflow.json from packageDir → parseManifest → validate
5. readConfig(projectDir)
6. Collision detection (read other manifests, check .opencode/ files) → warnings
7. addPlugin(config, packageName)
8. setWorkflow(config, manifestName, { package, version, agents, commands, skills })
9. writeConfig(projectDir, config)
10. Return result
```

**Rollback by failure point:**

| Fails at | What's been done | Rollback |
|----------|------------------|----------|
| Step 3 (bun add) | Nothing committed | None needed — bun failed, nothing installed |
| Step 4 (manifest read/parse) | Package installed in `.opencode/node_modules/` | `bun remove` the package |
| Step 6 (collision detection) | N/A — collisions warn, never fail | N/A |
| Step 9 (writeConfig) | Package installed, config not yet written | `bun remove` the package |

Key insight: config is written atomically at step 9. If anything fails before that, Hugo only needs to `bun remove`. If writeConfig itself fails (disk full, permissions), the package is installed but config is clean — user can retry `hugo install --force`.

With `--force` on reinstall: skip the "already installed" check, overwrite hugo state, ensure plugin is in array.

#### Remove

```
1. readConfig(projectDir)
2. Get workflow entry from hugo.workflows → error if not found
3. removePlugin(config, entry.package)
4. removeWorkflow(config, name)
5. writeConfig(projectDir, config)
6. bun remove <package>
7. Return result
```

Works regardless of enabled/disabled. If disabled, plugin is already absent from the array — just clean up hugo state and bun package.

#### Update

```
1. readConfig(projectDir)
2. Get target workflow entries from hugo.workflows → error if none/not found
3. bun update [package]
4. For each updated workflow:
   a. Re-read workflow.json from packageDir → get new manifest
   b. Re-read package.json for version
   c. If version changed or manifest changed:
      - Collision detection on new names → warnings
      - Update workflow entry in hugo.workflows (agents, commands, skills, version)
      - Preserve enabled/disabled state
5. writeConfig(projectDir, config)
6. Return result (version changes, structural changes)
```

The plugin array doesn't change on update — the package name stays the same. OpenCode will load the updated plugin on next startup.

#### Enable

```
1. readConfig(projectDir)
2. For each specified workflow name (or all if --all):
   a. Get workflow entry from hugo.workflows → error if not found
   b. If hasPlugin(config, entry.package) → skip with note (already enabled)
   c. Collision detection → warnings
   d. addPlugin(config, entry.package)
3. writeConfig(projectDir, config)
4. Return result
```

#### Disable

```
1. readConfig(projectDir)
2. For each specified workflow name (or all if --all):
   a. Get workflow entry from hugo.workflows → error if not found
   b. If !hasPlugin(config, entry.package) → skip with note (already disabled)
   c. removePlugin(config, entry.package)
3. writeConfig(projectDir, config)
4. Return result
```

#### Switch

```
1. readConfig(projectDir)
2. Validate all specified workflow names exist → error if any not found
3. For each currently enabled workflow not in the specified set:
   - removePlugin(config, entry.package)
4. For each specified workflow not currently enabled:
   - Collision detection → warnings
   - addPlugin(config, entry.package)
5. writeConfig(projectDir, config)
6. Return result (what was disabled, what was enabled)
```

Atomic — one config read, one config write.

#### List

```
1. readConfig(projectDir)
2. Get workflow entries from hugo.workflows
3. If name specified → filter to that workflow, error if not found
4. For each workflow, derive enabled status from plugin array
5. Return workflow entries with details and enabled/disabled status
```

List reads only from cached Hugo state in `opencode.json`. It does not read from `.opencode/node_modules/`. The cache is refreshed by `install` and `update` — if a user runs `bun update` directly, the cache may be stale. `hugo health` can detect version mismatches for that case.

#### Health

```
1. readConfig(projectDir)
2. Determine scope:
   - No args → all enabled workflows
   - Specific name → that workflow (enabled or disabled)
   - --all → all workflows (enabled and disabled)
3. Read manifests from all in-scope workflows
4. Scan .opencode/agents/ and .opencode/commands/ directories
5. Read opencode.json for user-defined agent/command entries
6. For each workflow in scope, for each agent/command/skill it declares:
   a. Check if another workflow declares the same name (cross-workflow collision)
   b. Check if .opencode/<type>/<name>.md exists (user file override)
   c. Check if user-defined config entry exists at same name
7. Return health report per workflow
```

### 9. Types — `src/workflows/types.ts`

```typescript
export type PackageSource =
  | { type: "registry"; name: string }
  | { type: "git"; url: string; ref?: string }
  | { type: "file"; path: string };

export type WorkflowManifest = {
  agents: string[];
  commands: string[];
  skills: string[];
};

export type WorkflowEntry = {
  package: string;
  version: string;
  agents: string[];
  commands: string[];
  skills: string[];
};

export type CollisionWarning = {
  type: "cross-workflow" | "overridden-by-file" | "overridden-by-user-config";
  entity: "agent" | "command" | "skill";
  name: string;
  detail: string;
};

export type HealthReport = {
  workflow: string;
  enabled: boolean;
  warnings: CollisionWarning[];
};
```

`PackageSource` is still used by `parsePackageSpec` and `installPackage` at install time — it's transient, not persisted in state.

`WorkflowEntry` is lean: just the package name, cached version, and cached manifest data. Enabled status is derived from the `plugin` array, not stored here.

### 10. CLI

Full CLI specification is in `plans/cli-v2.md`. Summary:

```
hugo install <package>       Install + enable a workflow (--force for reinstall)
hugo i <package>             Alias
hugo remove <name>           Remove a workflow entirely
hugo rm <name>               Alias
hugo update [name]           Update all or specific workflow
hugo enable <name...>        Enable workflows (--all for all)
hugo disable <name...>       Disable workflows (--all for all)
hugo switch <name...>        Disable all others, enable only these
hugo list [name]             List workflows with details + status
hugo ls [name]               Alias
hugo health [name]           Check collisions (--all includes disabled)
hugo build                   Generate workflow.json manifest (for workflow authors)
```

### 11. Plugin Integration

Hugo is an OpenCode plugin (`src/index.ts`). Currently it configures MCP servers via the `config` hook. Hugo's plugin role is separate from its CLI role — the plugin provides Hugo's own MCP tools, while the CLI manages workflow packages.

Workflow packages are **separate** OpenCode plugins. Each workflow has its own plugin entry point that registers its agents, commands, skills, MCPs, and any other OpenCode integrations. This gives workflow authors full access to OpenCode's plugin API.

### 12. Build Command — `hugo build`

For workflow authors. Scans conventional directories and generates the manifest.

**What it does:**
1. Read `package.json` for name and description (warns if missing)
2. Scan `agents/*.md` for agent names (filename minus `.md`)
3. Scan `commands/*.md` for command names (filename minus `.md`)
4. Scan `skills/*/SKILL.md` for skill names (directory name)
5. Generate `workflow.json` manifest with the discovered names

**What it does NOT do:**
- Read or validate `.md` file contents — just scans for filenames
- Generate code — the plugin entry point is the workflow author's responsibility

#### Plugin entry point is the author's responsibility

Workflow authors write their own plugin entry point (the `main` in `package.json`). This is the code OpenCode actually loads. It typically reads `.md` files, parses YAML frontmatter (using `gray-matter` or similar), and registers agents/commands via the `config` hook.

Hugo doesn't generate, manage, or validate the plugin entry point. `hugo build` only produces `workflow.json` — metadata for Hugo's `list` and `health` commands.

**Why not generate it:** The plugin entry point is the core of the workflow package. It decides how agents are registered, what MCPs to configure, whether to add event hooks or custom tools. Code generation creates a black box that's hard to debug, couples Hugo to OpenCode's internal API, and requires escape hatches for any non-trivial workflow. A ~20-line plugin file written once by the author is simpler and more maintainable than a code generator.

**OpenCode's `.md` format (for reference — used by the plugin, not by Hugo):**

Agent `.md` files:
```yaml
---
description: Reviews code for quality          # required
mode: subagent                                  # subagent | primary | all
model: anthropic/claude-sonnet-4-20250514     # optional
temperature: 0.1                                # optional
steps: 10                                       # optional
# ... any Agent config field from OpenCode's schema
---
You are a code reviewer. Focus on security and maintainability.
```
Frontmatter fields map to OpenCode's `Agent` config. Body becomes the `prompt`.

Command `.md` files:
```yaml
---
description: Run a code review
agent: reviewer                                 # optional — which agent runs this
model: anthropic/claude-sonnet-4-20250514     # optional
subtask: true                                   # optional
---
Review the code changes and provide feedback.
```
Frontmatter fields map to OpenCode's `Command` config. Body becomes the `template`.

## File Structure (v2)

```
src/
  cli.ts                        # CLI entry point — 9 commands
  index.ts                      # OpenCode plugin entry (unchanged)
  workflows/
    types.ts                    # PackageSource, WorkflowEntry, WorkflowManifest, CollisionWarning, HealthReport
    manifest.ts                 # parseManifest (validate workflow.json)
    bun.ts                      # installPackage, removeDependency, runUpdate, parsePackageSpec, getInstalledVersion
    utils.ts                    # stripVersion
    config.ts                   # read/write opencode.json, manage plugin array + hugo state
  commands/
    install.ts                  # Install package + add to plugin array
    remove.ts                   # Remove from plugin array + bun remove
    update.ts                   # Bun update + re-read manifest + update state
    enable.ts                   # Add to plugin array
    disable.ts                  # Remove from plugin array
    switch.ts                   # Atomic disable-all + enable-specified
    list.ts                     # List with details from manifests
    health.ts                   # Collision checking via manifests
    build.ts                    # Generate workflow.json manifest
```

## Testing Strategy

### Test infrastructure to preserve

- `tests/helpers.ts` — createTempDir, runCLI, fixtureDir, fileExists, readFileContent patterns are reusable. Remove readState (no more state.json). Add readConfig helper.
- `tests/fixtures/packages/` — fixture packages need updating to be valid workflow plugins with `workflow.json` manifests.

### New test layers

**Unit tests:**
- `manifest.test.ts` — parseManifest validation (valid/invalid manifests, missing fields, duplicates)
- `config.test.ts` — read/write opencode.json; plugin array management (add/remove/has); Hugo state CRUD; preserve existing user config; handle missing file; JSONC reading
- `bun.test.ts` — parsePackageSpec + installPackage
- `utils.test.ts` — stripVersion

**Integration tests:**
- `install.test.ts` — install adds to plugin array + hugo state, collision warnings, --force reinstall, rollback on failure
- `remove.test.ts` — remove cleans up plugin array + hugo state, bun dependency removed, works on enabled and disabled
- `update.test.ts` — update re-reads manifest, detects structural changes, respects enabled/disabled state
- `enable.test.ts` — enable adds to plugin array, handles already-enabled, collision warnings, --all flag
- `disable.test.ts` — disable removes from plugin array, handles already-disabled, --all flag
- `switch.test.ts` — switch disables others and enables specified, atomic behavior
- `list.test.ts` — list reads hugo state + manifests, shows enabled/disabled, filters by name
- `health.test.ts` — collision detection across workflows, user file overrides, user config entries
- `build.test.ts` — scans directories, generates manifest, handles missing files/dirs, no-content scenarios

**CLI tests:**
- Same pattern as v1: runCLI against the compiled binary, check stdout/stderr/exit codes
- Test each command's output formatting
- Test argument validation, unknown flag rejection

### Fixture updates

Existing fixtures need `workflow.json` manifests for Hugo to read:
- Add `workflow.json` manifests (replacing `hugo-workflow.json`)
- Add frontmatter to `.md` files (for realistic testing, though Hugo doesn't parse them)
- Plugin entry points are not needed in fixtures — Hugo doesn't read or validate them

## Implementation Order

### Phase 1: Foundation
1. ~~Archive v1 source and tests~~ ✓
2. ~~Add `jsonc-parser` dependency~~ ✓
3. Write `types.ts` — new types (no ParsedAgent/ParsedCommand)
4. Rewrite `manifest.ts` — validate `workflow.json` format (no .md parsing)
5. Create `config.ts` — opencode.json reader/writer + plugin array management + Hugo state
6. Enhance `bun.ts` — add `installPackage` (encapsulates dep-diffing)
7. Clean up `utils.ts` — remove hashFile
8. Update fixtures — workflow.json manifests
9. Unit tests for all foundation modules

### Phase 2: Core Commands
10. Rewrite `install.ts` — add to plugin array + hugo state, with integration tests
11. Rewrite `remove.ts` — remove from plugin array + hugo state + bun remove, with integration tests
12. Rewrite `update.ts` — bun update + re-read manifest + update state, with integration tests
13. Rewrite `list.ts` — reads hugo state + manifests, with integration tests

### Phase 3: Workflow Management Commands
14. Create `enable.ts` — add to plugin array, with integration tests
15. Create `disable.ts` — remove from plugin array, with integration tests
16. Create `switch.ts` — atomic disable-all + enable-specified, with integration tests
17. Create `health.ts` — manifest-based collision checking, with integration tests

### Phase 4: Authoring
18. Create `build.ts` — scan directories, generate workflow.json manifest, with integration tests

### Phase 5: CLI + Verification
19. Rewrite `cli.ts` — 9 commands with all flags
20. CLI tests — full binary tests for each command
21. Build and typecheck — clean
22. End-to-end test with real workflow package

## Decisions

### JSONC handling
Start with standard JSON for writing. Use `jsonc-parser` for reading. Hugo may strip comments from `opencode.json` when it writes. Upgrade to comment-preserving writes later if needed.

### Plugin array management
Hugo adds/removes package names from the `plugin` array. It does not namespace or prefix them. The package name in the `plugin` array is the npm package name exactly as bun installs it.

### Workflow packages are OpenCode plugins
Each workflow package exports an OpenCode plugin function. The plugin handles its own agent/command/skill/MCP registration. This gives workflow authors full access to OpenCode's plugin API. The plugin entry point is always written by the workflow author — Hugo does not generate it.

### Collision behavior
All collisions warn and continue. They never error and never block installation or enabling. Collision detection reads manifests to find name overlaps — it doesn't inspect what the plugins actually register at runtime. Two workflows declaring the same agent name in their manifests triggers a warning. The actual runtime behavior depends on OpenCode's plugin load order.

### Manifest is metadata for Hugo
The manifest exists for Hugo's tracking — listing what the workflow provides so `hugo list` and `hugo health` have data. It's not used by OpenCode directly. The plugin entry point is what OpenCode loads.

### --force flag
Only available on `install`. Used exclusively for reinstalling an already-installed workflow. Not available on any other command.

### Enable/disable is plugin array presence
Enabled = package name in `plugin` array. Disabled = package name not in `plugin` array. No other config changes needed.

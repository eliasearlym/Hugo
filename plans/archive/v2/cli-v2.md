# CLI v2 — Command Reference

## Global Behavior

- **Workflow names** are used for all commands after install. Install takes a package spec; everything else takes the workflow name. The workflow name is derived by stripping the npm scope from the package name: `@org/code-review` → `code-review`. If two packages produce the same workflow name, install errors (this is a hard error, not a warning).
- **Exit codes:** 0 for success, 1 for failure. Error messages do the heavy lifting — no granular exit codes.
- **Help:** Global only (`hugo --help` / `hugo -h`). No per-command help.
- **Output:** Plain text. Colors and emoji improvements are deferred.
- **No `--json` flag.** Machine-readable output is premature.
- **Enabled/disabled model.** Workflows can be installed but inactive. Enabled = package name is in the `plugin` array of `opencode.json`. Disabled = package name is not in the array. Install enables by default. Disabled workflows stay tracked in Hugo state but OpenCode doesn't load them.

---

## Commands

### `hugo install <package>`

Aliases: `hugo i <package>`

Installs a workflow package and enables it — adds the package to the `plugin` array in `opencode.json` so OpenCode loads it on next startup.

**Package sources** (all handled by bun):
- Registry: `@org/code-review`, `code-review`
- Git: `github:org/repo`, `https://github.com/org/repo`
- Local: `./path/to/package`, `/absolute/path`

Version pinning (`@org/code-review@1.2.3`) works silently via bun. Not documented in help text.

**Flags:**
- `--force` — Allows reinstall of an already-installed workflow (re-reads manifest, refreshes Hugo state, ensures plugin is in array).

**Behavior:**

| Scenario | Result |
|----------|--------|
| New install | Install package, add to plugin array, write Hugo state, report success |
| Already installed | Error: `"code-review" is already installed. Use --force to reinstall.` |
| Already installed + `--force` | Refresh Hugo state, re-enable if disabled |
| Naming collision (user has same agent/command in config or `.opencode/` dir) | Warn and continue — user's version takes precedence |
| Partial failure (bun succeeds but manifest invalid) | Rollback: remove from plugin array, remove Hugo state, `bun remove` package |

**Output:**
```
$ hugo install @org/code-review
Installed "code-review" v1.0.0 (1 agent, 1 command, 1 skill)
```

With collision warnings:
```
$ hugo install @org/code-review
  ⚠ Agent "reviewer" is already defined in opencode.json — workflow version will not be used
Installed "code-review" v1.0.0 (1 agent, 1 command, 1 skill)
```

**Errors:**
```
$ hugo install
Error: missing package spec

Usage: hugo install <package>
```

```
$ hugo install @org/code-review
Error: "code-review" is already installed. Use --force to reinstall.
```

```
$ hugo install @org/nonexistent-package
Error: Failed to install "@org/nonexistent-package": package not found
```

---

### `hugo remove <name>`

Aliases: `hugo rm <name>`

Removes a workflow entirely — removes from plugin array, cleans up Hugo state, and uninstalls the package via bun. Works regardless of whether the workflow is enabled or disabled.

**Flags:** None.

**Behavior:**

| Scenario | Result |
|----------|--------|
| Workflow found (enabled) | Remove from plugin array, remove Hugo state, `bun remove`, report success |
| Workflow found (disabled) | Remove Hugo state, `bun remove`, report success (already absent from plugin array) |
| Workflow not found | Error: `Workflow "bad-name" is not installed.` |

Hugo never touches user files. No mention of shadowed entries, no file-level detail in output.

**Output:**
```
$ hugo remove code-review
Removed "code-review" (1 agent, 1 command, 1 skill)
```

**Errors:**
```
$ hugo remove
Error: missing workflow name

Usage: hugo remove <name>
```

```
$ hugo remove bad-name
Error: Workflow "bad-name" is not installed.
```

---

### `hugo update [name]`

Updates all workflows or a specific one. Runs `bun update` then re-reads manifests and updates Hugo state (cached version, agents, commands, skills). The plugin array is unchanged — package names don't change on update. Enabled/disabled state is preserved. Version management is left to bun — Hugo just syncs its cached state after the package changes.

**Flags:** None.

**Behavior:**

| Scenario | Result |
|----------|--------|
| Specific workflow updated (enabled) | Report version change and structural changes |
| Specific workflow updated (disabled) | Report version change, note it remains disabled |
| Specific workflow already up to date | `"code-review" already up to date.` |
| All workflows updated | Report each, noting version changes and up-to-date ones |
| All workflows up to date | `All workflows up to date.` |
| No workflows installed | Error: `No workflows installed.` |
| Workflow not found | Error: `Workflow "bad-name" is not installed.` |
| Update adds new agent/command with naming collision | Warn and continue (same as install) |

**Output — specific workflow:**
```
$ hugo update code-review
Updated "code-review" v1.0.0 → v1.1.0
```

With structural changes:
```
$ hugo update code-review
Updated "code-review" v1.0.0 → v2.0.0 (added agent: linter, removed command: review)
```

**Output — all workflows:**
```
$ hugo update
Updated "code-review" v1.0.0 → v1.1.0
"debugging" already up to date.
```

**Errors:**
```
$ hugo update bad-name
Error: Workflow "bad-name" is not installed.
```

```
$ hugo update
Error: No workflows installed.
```

---

### `hugo enable <name...>`

Activates one or more installed workflows. Adds their package names to the `plugin` array in `opencode.json` so OpenCode loads them on next startup.

**Flags:**
- `--all` — Enable all installed workflows.

**Behavior:**

| Scenario | Result |
|----------|--------|
| One or more workflows specified | Enable each (add to plugin array), report success |
| Already enabled | Skip with note: `"code-review" is already enabled.` |
| `--all` | Enable all disabled workflows |
| `--all` with all already enabled | `All workflows are already enabled.` |
| Workflow not found | Error: `Workflow "bad-name" is not installed.` |
| No workflows installed | Error: `No workflows installed.` |
| Naming collision on enable | Warn and continue (same as install) |

**Output — single workflow:**
```
$ hugo enable code-review
Enabled "code-review" (1 agent, 1 command, 1 skill)
```

**Output — multiple workflows:**
```
$ hugo enable code-review debugging
Enabled "code-review" (1 agent, 1 command, 1 skill)
Enabled "debugging" (1 agent)
```

**Output — all:**
```
$ hugo enable --all
Enabled "code-review" (1 agent, 1 command, 1 skill)
Enabled "debugging" (1 agent)
"testing" is already enabled.
```

**Errors:**
```
$ hugo enable
Error: missing workflow name (or use --all)

Usage: hugo enable <name...>
```

```
$ hugo enable bad-name
Error: Workflow "bad-name" is not installed.
```

---

### `hugo disable <name...>`

Deactivates one or more installed workflows. Removes their package names from the `plugin` array in `opencode.json` but keeps the package installed and tracked in Hugo state.

**Flags:**
- `--all` — Disable all installed workflows.

**Behavior:**

| Scenario | Result |
|----------|--------|
| One or more workflows specified | Disable each (remove from plugin array), report success |
| Already disabled | Skip with note: `"code-review" is already disabled.` |
| `--all` | Disable all enabled workflows |
| `--all` with all already disabled | `All workflows are already disabled.` |
| Workflow not found | Error: `Workflow "bad-name" is not installed.` |
| No workflows installed | Error: `No workflows installed.` |

**Output — single workflow:**
```
$ hugo disable code-review
Disabled "code-review"
```

**Output — multiple workflows:**
```
$ hugo disable code-review debugging
Disabled "code-review"
Disabled "debugging"
```

**Output — all:**
```
$ hugo disable --all
Disabled "code-review"
Disabled "debugging"
"testing" is already disabled.
```

**Errors:**
```
$ hugo disable
Error: missing workflow name (or use --all)

Usage: hugo disable <name...>
```

```
$ hugo disable bad-name
Error: Workflow "bad-name" is not installed.
```

---

### `hugo switch <name...>`

Disables all currently enabled workflows and enables only the specified ones. A quick way to swap your active workflow set in one command.

**Flags:** None.

**Behavior:**

| Scenario | Result |
|----------|--------|
| One or more workflows specified | Disable all others, enable only those specified |
| Specified workflow already enabled (others exist) | Disable the others, keep it enabled |
| All specified workflows are already the only enabled ones | `Already active: code-review.` |
| Workflow not found | Error: `Workflow "bad-name" is not installed.` |
| No workflows installed | Error: `No workflows installed.` |
| Naming collision on newly enabled workflow | Warn and continue (same as enable) |

**Output — single workflow:**
```
$ hugo switch code-review
Switched to "code-review"
  disabled: debugging, testing
```

**Output — multiple workflows:**
```
$ hugo switch code-review debugging
Switched to "code-review", "debugging"
  disabled: testing
```

**Output — nothing to change:**
```
$ hugo switch code-review
Already active: code-review.
```

**Output — nothing else to disable:**
```
$ hugo switch code-review
Switched to "code-review"
```

**Errors:**
```
$ hugo switch
Error: missing workflow name

Usage: hugo switch <name...>
```

```
$ hugo switch bad-name
Error: Workflow "bad-name" is not installed.
```

---

### `hugo list [name]`

Aliases: `hugo ls [name]`

Lists installed workflows with their details and enabled/disabled status. Reads from `hugo.workflows` in `opencode.json` — no node_modules validation.

**Flags:** None.

**Behavior:**

| Scenario | Result |
|----------|--------|
| Workflows installed, no argument | Show all workflows with details and status |
| Workflows installed, name argument | Show details for that one workflow |
| No workflows installed | `No workflows installed.` |
| Workflow not found | Error: `Workflow "bad-name" is not installed.` |

**Output — all workflows:**
```
$ hugo list
Installed workflows:

  code-review  v1.0.0  @org/code-review  (enabled)
    agents: reviewer
    commands: review
    skills: linting

  debugging  v2.1.0  @org/debugging  (disabled)
    agents: debugger
```

**Output — specific workflow:**
```
$ hugo list code-review
  code-review  v1.0.0  @org/code-review  (enabled)
    agents: reviewer
    commands: review
    skills: linting
```

**Errors:**
```
$ hugo list bad-name
Error: Workflow "bad-name" is not installed.
```

---

### `hugo health [name]`

Checks for naming collisions and shadowing issues across OpenCode's full config precedence chain. Without arguments, checks all enabled workflows. With a workflow name, checks that specific workflow regardless of enabled/disabled status. With `--all`, checks all installed workflows including disabled ones.

**Flags:**
- `--all` — Check all installed workflows (including disabled).

**OpenCode config precedence** (later wins):

| Priority | Source | Description |
|----------|--------|-------------|
| 1 | Remote | Remote/shared config |
| 2 | Global | `~/.config/opencode/config.json` — user's global config |
| 3 | Custom | Custom config file |
| 4 | Project `opencode.json` | **Where Hugo manages the `plugin` array** — plugins register agents/commands via config hook |
| 5 | `.opencode/` directories | File-based agents/commands/skills in the project |
| 6 | Inline | Inline config overrides |

Workflow plugins register agents/commands at priority 4 (via config hook at startup). Anything at priority 5 (`.opencode/` files) shadows plugin-registered entries. Health checks for these overlaps.

**Checks performed:**

| Check | Description |
|-------|-------------|
| Overridden by `.opencode/` file | `.opencode/agents/reviewer.md` (priority 5) overrides the plugin's `agent.reviewer` registered via config hook |
| Overridden by static project config | `agent.reviewer` exists as a static key in `opencode.json` (not from a plugin) — may conflict with the workflow's version |
| Cross-workflow collision | Two enabled workflows both declare the same agent/command/skill name in their manifests |

**Deferred:** Global config checks (`~/.config/opencode/config.json`) and cross-scope collision detection are out of scope for v2. Hugo only reads project-level `opencode.json` and `.opencode/` directories.

**Behavior:**

| Scenario | Result |
|----------|--------|
| No arguments | Check all enabled workflows against full precedence chain |
| Specific workflow name | Check that workflow (enabled or disabled) against full chain |
| `--all` | Check all installed workflows (enabled and disabled) against full chain |
| All healthy | `All workflows healthy.` |
| Issues found | Report per workflow |
| Workflow not found | Error: `Workflow "bad-name" is not installed.` |
| No workflows installed | Error: `No workflows installed.` |

**Output — issues found:**
```
$ hugo health
code-review:
  ⚠ agent "reviewer" — .opencode/agents/reviewer.md overrides workflow version

debugging:
  ✓ no issues
```

**Output — all healthy:**
```
$ hugo health
All workflows healthy.
```

**Output — specific workflow:**
```
$ hugo health code-review
code-review:
  ⚠ agent "reviewer" — .opencode/agents/reviewer.md overrides workflow version
```

**Output — all including disabled:**
```
$ hugo health --all
code-review (enabled):
  ⚠ agent "reviewer" — .opencode/agents/reviewer.md overrides workflow version

debugging (enabled):
  ✓ no issues

testing (disabled):
  ⚠ agent "linter" conflicts with agent "linter" from workflow "code-review"
```

**Errors:**
```
$ hugo health bad-name
Error: Workflow "bad-name" is not installed.
```

---

### `hugo build`

Generates the `workflow.json` manifest for workflow authors. Scans conventional directories (`agents/`, `commands/`, `skills/`) for filenames. Does not generate code — the plugin entry point is the author's responsibility.

**Flags:** None.

**Directory conventions:**
- `agents/<name>.md` — agent definitions with frontmatter
- `commands/<name>.md` — command definitions with frontmatter
- `skills/<name>/SKILL.md` — skill directories

**Behavior:**

| Scenario | Result |
|----------|--------|
| Valid package with agents/commands/skills | Generate `workflow.json`, report contents |
| No `package.json` | Error: `No package.json found. Run hugo build from a workflow package directory.` |
| Missing name in `package.json` | Warn: `package.json missing "name" field.` |
| Missing description in `package.json` | Warn: `package.json missing "description" field.` |
| No agents, commands, or skills found | Error: `No agents, commands, or skills found. Nothing to build.` |

**Validation checks:**
- Each skill directory contains a `SKILL.md` file
- No duplicate names within a category
- Note: Hugo does NOT read `.md` file contents or validate frontmatter. It scans filenames only. Frontmatter errors surface at runtime when OpenCode loads the plugin.

**Output:**
```
$ hugo build
Built workflow.json (2 agents, 1 command, 1 skill)
```

**Generated manifest:**
```json
{
  "agents": ["reviewer", "linter"],
  "commands": ["review"],
  "skills": ["analysis"]
}
```

Name and description are read from `package.json` — not duplicated in the manifest.

**Errors:**
```
$ hugo build
Error: No package.json found. Run hugo build from a workflow package directory.
```

```
$ hugo build
Error: No agents, commands, or skills found. Nothing to build.
```

---

## Help Text

```
hugo — workflow manager for OpenCode

Usage:
  hugo install <package>       Install a workflow package
  hugo i <package>             Alias for install
  hugo remove <name>           Remove an installed workflow
  hugo rm <name>               Alias for remove
  hugo update [name]           Update all workflows, or a specific one
  hugo enable <name...>        Enable one or more workflows
  hugo enable --all            Enable all workflows
  hugo disable <name...>       Disable one or more workflows
  hugo disable --all           Disable all workflows
  hugo switch <name...>        Disable all others, enable only these
  hugo list [name]             List installed workflows
  hugo ls [name]               Alias for list
  hugo health [name]           Check for collisions and shadowing
  hugo health --all            Check all workflows (including disabled)
  hugo build                   Generate workflow.json (for workflow authors)

Options:
  --force                      Force reinstall (install only)

Examples:
  hugo install @some-org/code-review
  hugo install github:org/code-review
  hugo install ./local-workflow
  hugo remove code-review
  hugo update
  hugo update code-review
  hugo enable code-review
  hugo enable code-review debugging
  hugo enable --all
  hugo disable code-review
  hugo disable --all
  hugo switch code-review
  hugo switch code-review debugging
  hugo list
  hugo health
  hugo health code-review
  hugo build
```

---

## Summary

| Command | Input | Flags | Key behavior |
|---------|-------|-------|-------------|
| `install` | Package spec | `--force` | Install + enable. Exists → error (force overrides). Collisions → warn. Partial fail → rollback. |
| `remove` | Workflow name | None | Remove from plugin array + Hugo state + bun remove. Works on enabled or disabled. |
| `update` | Workflow name (optional) | None | Bun update + re-read manifest + update Hugo state. Plugin array unchanged. |
| `enable` | Workflow name(s) | `--all` | Add to plugin array. Collisions → warn. |
| `disable` | Workflow name(s) | `--all` | Remove from plugin array. Keep package installed and tracked. |
| `switch` | Workflow name(s) | None | Disable all others, enable only specified. Atomic swap. |
| `list` | Workflow name (optional) | None | Show workflow details + enabled/disabled status. |
| `health` | Workflow name (optional) | `--all` | Check collisions/shadowing. No args → enabled only. Name → that workflow. `--all` → everything. |
| `build` | None | None | Scan directories for filenames, generate `workflow.json`. No code generation, no frontmatter validation. For workflow authors. |

# Hugo

A workflow manager and OpenCode plugin. Hugo lets you install, enable, disable, and switch between shareable workflow packages that extend OpenCode with custom agents, commands, and skills.

## What It Does

Hugo has two roles:

1. **OpenCode Plugin** — When registered as a plugin, Hugo injects built-in MCP servers (web search, Context7, grep.app) into your OpenCode config.

2. **Workflow Manager (CLI)** — A standalone CLI for managing workflow packages. Workflows are npm-publishable packages containing `.md`-based agent, command, and skill definitions. Hugo handles installation, version tracking, collision detection, and enable/disable toggling — all persisted in `opencode.json`.

## Installation

```bash
bun add @happily-dev/hugo
```

Register Hugo as a plugin in your `opencode.json`:

```json
{
  "plugin": ["@happily-dev/hugo"]
}
```

## CLI Usage

```
hugo <command> [options]
```

### Workflow Lifecycle

| Command | Description |
|---|---|
| `hugo install <package>` | Install a workflow package from npm, git, or a local path. Runs collision detection against enabled workflows and writes metadata to `opencode.json`. Use `--force` to reinstall. |
| `hugo remove <name>` | Remove an installed workflow. Cleans up the plugin entry, workflow metadata, and the underlying npm dependency. |
| `hugo update [name]` | Update all installed workflows, or a specific one. Detects version and manifest changes (added/removed agents, commands, skills) and reports them. |
| `hugo build` | Generate `workflow.json` from a conventional directory structure (`agents/*.md`, `commands/*.md`, `skills/*/SKILL.md`). For workflow authors. |

### Enable / Disable

Workflows can be installed but inactive. Only enabled workflows are registered as OpenCode plugins.

| Command | Description |
|---|---|
| `hugo enable <name...>` | Enable one or more workflows. Runs collision detection before enabling. |
| `hugo enable --all` | Enable all installed workflows. |
| `hugo disable <name...>` | Disable one or more workflows. The workflow stays installed but is removed from the active plugin list. |
| `hugo disable --all` | Disable all installed workflows. |
| `hugo switch <name...>` | Disable all currently enabled workflows, then enable only the specified ones. Useful for swapping between workflow sets. |

### Inspection

| Command | Description |
|---|---|
| `hugo list [name]` | List installed workflows with version, package name, enabled/disabled status, and declared agents/commands/skills. |
| `hugo health [name]` | Check enabled workflows for collisions: cross-workflow name conflicts, file overrides (`.opencode/agents/<name>.md`), and user config overrides (`opencode.json`). |
| `hugo health --all` | Check all installed workflows (including disabled) against each other. |

### Package Sources

Hugo accepts any package specifier that `bun add` supports:

```bash
hugo install @some-org/code-review        # npm registry
hugo install @some-org/code-review@^2.0   # with version range
hugo install github:org/code-review       # git
hugo install ./local-workflow              # local path
```

### Aliases

| Alias | Equivalent |
|---|---|
| `hugo i` | `hugo install` |
| `hugo rm` | `hugo remove` |
| `hugo ls` | `hugo list` |

## How State Is Managed

Hugo stores all workflow state in `opencode.json` under the `hugo` key:

- **`plugin`** (top-level array) — Lists enabled workflow packages. This is the OpenCode plugin registry.
- **`hugo.workflows.<name>`** — Cached metadata per workflow: package name, version, and declared agents/commands/skills. Updated on install and update.

No separate config file. No database. One source of truth.

## Writing a Workflow Package

A workflow package is an npm package with a `workflow.json` manifest at its root. Use `hugo build` to generate it from a conventional directory layout:

```
my-workflow/
  package.json
  agents/
    code-review.md
    debugging.md
  commands/
    check-types.md
  skills/
    testing/
      SKILL.md
```

Running `hugo build` produces:

```json
{
  "agents": ["code-review", "debugging"],
  "commands": ["check-types"],
  "skills": ["testing"]
}
```

Publish to npm and install with `hugo install`.

## Built-in MCP Servers

When used as an OpenCode plugin, Hugo registers these MCP servers (user config takes precedence):

| Server | URL | Auth |
|---|---|---|
| Web Search (Exa) | `mcp.exa.ai` | `EXA_API_KEY` env var (optional) |
| Context7 | `mcp.context7.com` | `CONTEXT7_API_KEY` env var (optional) |
| grep.app | `mcp.grep.app` | None |

## Development

```bash
bun install
bun run build      # bundle + emit type declarations
bun test           # run test suite
bun run typecheck  # type-check without emitting
```

## License

MIT

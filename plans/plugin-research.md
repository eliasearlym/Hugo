# Research: OpenCode Plugin System & Workflow Registration

Research into how OpenCode plugins register agents, commands, skills, and MCPs — and what this means for Hugo's workflow authoring model.

## Context

Hugo tracks what each installed workflow provides (agents, commands, skills, MCPs) via `workflow.json` manifests and cached state. This tracking powers `hugo ls`, `hugo health`, and collision detection. But Hugo's tracking is only useful if workflows can actually *deliver* these items to OpenCode at runtime. This document examines the runtime side.

## How OpenCode discovers configuration

OpenCode loads configuration from multiple sources, merged in priority order:

1. **Managed config** (enterprise, highest priority)
2. **Project config** (`opencode.json` in project root)
3. **Global config** (`~/.config/opencode/opencode.json`)
4. **Plugin hooks** (via `config` hook on the `Hooks` interface)

### Filesystem discovery paths

OpenCode auto-discovers agents, commands, and skills from well-known directories. It does **not** scan plugin package directories (`node_modules/`).

**Agents** (markdown files):
- `.opencode/agents/<name>.md`
- `~/.config/opencode/agents/<name>.md`

**Commands** (markdown files):
- `.opencode/commands/<name>.md`
- `~/.config/opencode/commands/<name>.md`

**Skills** (directories with SKILL.md):
- `.opencode/skills/<name>/SKILL.md`
- `~/.config/opencode/skills/<name>/SKILL.md`
- `.claude/skills/<name>/SKILL.md` (Claude-compatible)
- `~/.claude/skills/<name>/SKILL.md`
- `.agents/skills/<name>/SKILL.md` (agent-compatible)
- `~/.agents/skills/<name>/SKILL.md`

OpenCode walks up from the working directory to the git worktree root, scanning each level.

**MCPs**: No filesystem convention. Configured only via `opencode.json` under the `mcp` key or programmatically via a plugin's `config` hook.

Source: https://opencode.ai/docs/agents/, https://opencode.ai/docs/commands/, https://opencode.ai/docs/skills/

## The plugin Hooks interface

From the OpenCode plugin SDK (`packages/plugin/src/index.ts` on the `dev` branch, verified Feb 2026):

```typescript
export type Plugin = (input: PluginInput) => Promise<Hooks>

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  $: BunShell
}

export interface Hooks {
  config?: (input: Config) => Promise<void>
  tool?: { [key: string]: ToolDefinition }
  auth?: AuthHook
  event?: (input: { event: Event }) => Promise<void>
  "chat.message"?: ...
  "chat.params"?: ...
  "chat.headers"?: ...
  "permission.ask"?: ...
  "command.execute.before"?: ...
  "tool.execute.before"?: ...
  "tool.execute.after"?: ...
  "shell.env"?: ...
  "experimental.chat.messages.transform"?: ...
  "experimental.chat.system.transform"?: ...
  "experimental.session.compacting"?: ...
  "experimental.text.complete"?: ...
}
```

The `config` hook receives the full `Config` object from `@opencode-ai/sdk` and can mutate it. This is how plugins programmatically register agents, commands, MCPs, and other configuration.

The `tool` hook lets plugins register custom tools directly (not via config).

Source: https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts

## What the Config type includes

The `Config` type (from `@opencode-ai/sdk`) includes these fields relevant to workflow registration:

| Field | Type | Plugin can set via `config` hook |
|-------|------|----------------------------------|
| `agent` | `Record<string, AgentConfig>` | Yes |
| `command` | `Record<string, CommandConfig>` | Yes |
| `mcp` | `Record<string, McpConfig>` | Yes |
| `tools` | `Record<string, boolean>` | Yes |
| `plugin` | `string[]` | Yes |
| `skill` | — | **No. Field does not exist.** |

Agents, commands, and MCPs can all be registered programmatically via the `config` hook. Skills cannot.

Source: https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts

## Registration capabilities by category

| Category | Via `config` hook | Via filesystem discovery | Via `tool` hook |
|----------|-------------------|------------------------|-----------------|
| **Agents** | `config.agent.<name> = { ... }` | `.opencode/agents/<name>.md` | No |
| **Commands** | `config.command.<name> = { ... }` | `.opencode/commands/<name>.md` | No |
| **MCPs** | `config.mcp.<name> = { ... }` | No filesystem convention | No |
| **Skills** | **Not possible** | `.opencode/skills/<name>/SKILL.md` | No |
| **Custom tools** | No | No | `tool: { myTool: tool({...}) }` |

### What this means for workflow plugins

A workflow plugin (an npm package in the `plugin` array) can:
- Register agents by setting `config.agent` in the config hook
- Register commands by setting `config.command` in the config hook
- Register MCPs by setting `config.mcp` in the config hook
- Register custom tools via the `tool` property on the hooks object
- Hook into events, tool execution, chat messages, shell env, etc.

A workflow plugin **cannot**:
- Register skills via any supported mechanism
- Tell OpenCode to scan additional directories for configuration files

## The skills gap

Skills are the one category that workflow plugins genuinely cannot provide through any supported mechanism today.

### Why skills matter for workflows

Skills are "reusable instructions" — SOPs, coding standards, deployment procedures, review checklists. They're loaded on-demand via OpenCode's native `skill` tool. An agent sees available skills listed in its context and can load specific ones when relevant.

For workflows (curated bundles of agents + commands + skills + MCPs), skills are often the most valuable part. A code review workflow might provide a "review-checklist" skill. A deployment workflow might provide a "deploy-procedure" skill. Without skills, workflows lose a significant part of their value proposition.

### Current workarounds

1. **Manual placement**: Users manually copy skill files from the workflow package into `.opencode/skills/`. This defeats the purpose of `hugo install`.

2. **Plugin copies files at startup**: A plugin could use the `$` shell API to copy `SKILL.md` files into `.opencode/skills/` during initialization. This is fragile (race conditions with OpenCode's own skill discovery, file permission issues, cleanup on uninstall) and invasive (modifies the project directory outside of Hugo's control).

3. **Embed skill content in agent prompts**: Instead of registering skills, the plugin injects the skill content directly into agent system prompts via `config.agent.<name>.prompt`. This works but loses the on-demand discovery model — the content is always loaded regardless of relevance.

4. **Use custom tools instead**: Register a custom tool via the `tool` hook that returns skill-like content. The agent can call the tool when needed. This preserves the on-demand model but doesn't integrate with OpenCode's native skill discovery and listing.

None of these are satisfactory.

### Upstream activity

There are open feature requests that would resolve this:

- **[#6013](https://github.com/sst/opencode/issues/6013)**: "Add Skill Configuration to Config Type" — Requests adding `skill` to the `Config` type so plugins can register skills via the config hook. Status: open, assigned to @thdxr. This is the most direct solution.

- **[#6347](https://github.com/sst/opencode/issues/6347)**: "Plugin Hook for Registering Additional Config Directories" — Requests a hook that lets plugins tell OpenCode to scan additional directories. This would let a workflow plugin say "also scan my package directory for skills." Status: open.

- **[#6811](https://github.com/sst/opencode/issues/6811)** (PR): "Add agent, command, and skill hooks for direct plugin registration" — A community PR that adds direct registration hooks. Status: unclear if merged.

## Implications for Hugo

### What works today

Hugo's current architecture is sound for agents, commands, and MCPs:

1. **Build time**: `hugo build` scans markdown files (agents, commands, skills) and detects MCPs via plugin execution. This produces `workflow.json` with accurate tracking data.

2. **Runtime**: The workflow plugin registers agents via `config.agent`, commands via `config.command`, MCPs via `config.mcp`. The items Hugo tracks match what OpenCode receives.

3. **Lifecycle**: `hugo install/remove/enable/disable/switch/update` operate on the `plugin` array. This works regardless of what the plugin provides — toggling the plugin toggles everything it registers.

### What doesn't work today

Skills are tracked by Hugo but **cannot be delivered to OpenCode by workflow plugins**:

- `hugo build` scans `skills/*/SKILL.md` and records skill names in `workflow.json`
- `hugo ls` displays these skills
- `hugo health` checks for skill collisions
- But at runtime, the workflow plugin has no way to make OpenCode aware of these skills

This means Hugo's skill tracking is currently aspirational — it tracks what the workflow *intends* to provide, but the runtime delivery mechanism doesn't exist yet.

### Hugo's enable/disable/switch still works

Even without skill delivery, Hugo's lifecycle management is fully functional. Enable/disable/switch operate on the `plugin` array, which controls whether OpenCode loads the plugin at all. Everything the plugin registers (agents, commands, MCPs, custom tools) is toggled as a unit.

### Agents and commands work despite no filesystem discovery

A workflow plugin registers agents via `config.agent` and commands via `config.command` — it reads its own markdown files and passes the content programmatically. OpenCode doesn't need to discover the files; the plugin handles it. Hugo's markdown scanning at build time mirrors what the plugin will do at runtime.

## Options for Hugo

### Option A: Wait for upstream `config.skill` support

If OpenCode adds `config.skill` to the Config type (#6013), workflow plugins can register skills the same way they register agents and commands. Hugo's existing skill tracking becomes immediately useful with no changes needed on Hugo's side.

**Risk**: Timeline is uncertain. The issue has been open since Dec 2025.

### Option B: Hugo copies skill files on install/enable

Hugo could copy skill files from the installed workflow package into `.opencode/skills/` during `hugo install` and `hugo enable`, and remove them during `hugo remove` and `hugo disable`. This makes skills work today without upstream changes.

**Tradeoffs**:
- Hugo becomes responsible for file lifecycle (copy on install/enable, remove on remove/disable, update on update)
- Name collisions between workflows' skills need careful handling
- Must track which files Hugo placed vs. user-created files (to avoid deleting user content)
- `.opencode/skills/` is typically gitignored, which aligns well with installed content
- This is the "workaround #2" from above, but managed by Hugo rather than by each plugin individually — much cleaner

### Option C: Plugin copies skill files via init hook

Each workflow plugin copies its own skill files into `.opencode/skills/` during initialization using the `$` shell API. Hugo doesn't need to do anything special.

**Tradeoffs**:
- Every workflow author must implement this boilerplate
- No cleanup on disable/remove (plugin init doesn't run, so it can't clean up)
- Race conditions with OpenCode's skill discovery
- Hugo could provide a helper library to standardize this, but it's still per-plugin

### Option D: Custom tool as skill proxy

Workflow plugins register a custom tool (via the `tool` hook) that serves skill content on demand. This preserves the on-demand model but doesn't integrate with OpenCode's native `skill` tool.

**Tradeoffs**:
- Agents won't see these in the "available skills" list in their context
- Users can't say "use xyz skill" and have it work naturally
- Effectively a parallel skill system — confusing

### Recommendation

**Short term: Option B** (Hugo copies skill files). It's the only option that provides a good user experience today without requiring upstream changes or per-plugin boilerplate. Hugo already manages the install/enable/disable/remove lifecycle and tracks which skills each workflow provides — adding file copy/remove is a natural extension.

**Long term: Option A** (wait for `config.skill`). Once upstream support lands, workflow plugins register skills the same way they register everything else. Hugo can deprecate the file-copying mechanism and the transition is transparent to users — `hugo install` still works, skills still appear in `hugo ls`, the only difference is the runtime delivery path.

Both options are compatible — Hugo can start with Option B and migrate to Option A when it becomes available, with no changes to the workflow authoring model (authors still write `skills/*/SKILL.md` in their packages).

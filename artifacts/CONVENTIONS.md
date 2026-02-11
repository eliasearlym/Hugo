# Hugo — Conventions

> **Purpose**: Definitive reference for the file formats, directory layouts, and frontmatter schemas used by Hugo for agents, subagents, skills, and commands. Every convention documented here is either part of the Agent Skills open standard or confirmed in the OpenCode documentation. Claude Code-only conventions are excluded.
>
> **Sources**: [Agent Skills Specification](https://agentskills.io/specification) (AAIF open standard), [OpenCode Agents](https://opencode.ai/docs/agents), [OpenCode Skills](https://opencode.ai/docs/skills), [OpenCode Commands](https://opencode.ai/docs/commands), [Claude Code Skills](https://code.claude.com/docs/en/skills), [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents).

---

## 1. Standards Hierarchy

Hugo follows three layers of convention, in order of authority:

| Layer | Standard | Governs |
|-------|----------|---------|
| 1 | **Agent Skills Spec** (agentskills.io) | Skill file format, frontmatter schema, directory structure |
| 2 | **OpenCode conventions** (opencode.ai/docs) | Agent/command file format, discovery paths, permissions, tools |
| 3 | **Cross-tool compatibility** (shared by OpenCode + Claude Code) | Fallback paths, common frontmatter fields |

When the Agent Skills spec and OpenCode docs conflict, the Agent Skills spec governs skill definitions and OpenCode governs agent/command definitions.

---

## 2. Universal Format: Markdown + YAML Frontmatter

All definition files (agents, skills, commands) share the same base format:

```markdown
---
field: value
another-field: value
---

Markdown body content here.
```

- Frontmatter is parsed as YAML between `---` delimiters.
- The markdown body after the closing `---` is the primary content (system prompt for agents, instructions for skills, prompt template for commands).
- Unknown frontmatter fields are ignored by both OpenCode and Claude Code.

---

## 3. Skills

### 3.1 What Skills Are

Skills are on-demand capability modules that agents discover and load when relevant to a task. A skill is a directory containing a `SKILL.md` file and optional supporting resources. Skills use **progressive disclosure** — only metadata loads at startup; full content loads on activation; reference files load only when needed.

### 3.2 Directory Structure

A skill is a directory. The directory name is the skill's identity.

```
skill-name/
├── SKILL.md              # Required — entry point (ALL CAPS)
├── scripts/              # Optional — executable code agents can run
│   ├── extract.py
│   └── validate.sh
├── references/           # Optional — additional docs loaded on demand
│   ├── REFERENCE.md
│   └── api-guide.md
└── assets/               # Optional — static resources (templates, schemas, data)
    ├── template.json
    └── schema.yaml
```

The three standard optional directories from the Agent Skills spec are:

| Directory | Purpose | Loaded |
|-----------|---------|--------|
| `scripts/` | Self-contained executable code (Python, Bash, JS). Should include error handling. | Executed on demand; only output enters context |
| `references/` | Additional documentation for deep reference. Keep files focused and small. | Read on demand by the agent |
| `assets/` | Static resources: templates, images, lookup tables, schemas, data files. | Read on demand by the agent |

Additional files and subdirectories beyond these three are permitted. Claude Code's own docs show skills with arbitrary file layouts (e.g., `examples/sample.md`, `template.md` as siblings). The convention is: **put supporting files wherever makes sense, and reference them from SKILL.md so the agent knows what they are and when to load them**.

### 3.3 Discovery Paths

OpenCode searches these locations for skills (all locations checked, first match by name wins):

| Location | Scope |
|----------|-------|
| `.opencode/skills/<name>/SKILL.md` | Project (OpenCode) |
| `.claude/skills/<name>/SKILL.md` | Project (Claude Code compatible) |
| `.agents/skills/<name>/SKILL.md` | Project (Agent Skills standard) |
| `~/.config/opencode/skills/<name>/SKILL.md` | User (OpenCode) |
| `~/.claude/skills/<name>/SKILL.md` | User (Claude Code compatible) |
| `~/.agents/skills/<name>/SKILL.md` | User (Agent Skills standard) |

For project-local paths, OpenCode walks up from the current working directory to the git worktree root, loading matching skills along the way. This supports monorepo setups where packages have their own skills.

**Recommended primary path**: `.opencode/skills/` for project skills, `~/.config/opencode/skills/` for user skills.

### 3.4 SKILL.md Frontmatter

The Agent Skills spec defines the canonical frontmatter schema. OpenCode recognizes exactly these fields:

```yaml
---
name: pdf-processing
description: >
  Extracts text and tables from PDF files, fills PDF forms, and merges
  multiple PDFs. Use when working with PDF documents or when the user
  mentions PDFs, forms, or document extraction.
license: Apache-2.0
compatibility: Requires poppler-utils and Python 3.10+
metadata:
  author: example-org
  version: "1.0"
allowed-tools: Bash(python3:*) Read
---
```

| Field | Required | Constraints | Notes |
|-------|----------|-------------|-------|
| `name` | **Yes** | 1-64 chars. Lowercase alphanumeric + hyphens. No leading/trailing/consecutive hyphens. Must match parent directory name. Regex: `^[a-z0-9]+(-[a-z0-9]+)*$` | Becomes the skill identifier and slash command name |
| `description` | **Yes** | 1-1024 chars. Should describe what the skill does AND when to use it. Include keywords for task matching. | Loaded into agent context at startup for all installed skills (~100 tokens each) |
| `license` | No | Free-form string | License name or reference to bundled LICENSE file |
| `compatibility` | No | Max 500 chars | Environment requirements: intended product, system packages, network needs |
| `metadata` | No | String-to-string key-value map | Arbitrary metadata (author, version, tags, etc.) |
| `allowed-tools` | No | Space-delimited tool names | Pre-approved tools the skill may use. Experimental. |

**Unknown frontmatter fields are ignored by OpenCode.** This means Claude Code extension fields (`disable-model-invocation`, `user-invocable`, `context`, `agent`, `argument-hint`, `hooks`, `model`) can be included for Claude Code portability without breaking OpenCode.

### 3.5 SKILL.md Body

The markdown body after frontmatter contains skill instructions. There are no format restrictions. Write whatever helps agents perform the task effectively.

**Recommended content:**
- Step-by-step instructions for common tasks
- Examples of inputs and expected outputs
- Common edge cases and how to handle them
- File references to supporting resources in the skill directory

**Size guidelines:**
- Keep `SKILL.md` under **500 lines** / **~5,000 tokens**
- Move detailed reference material to files in `references/`
- Use relative paths when referencing other files: `See [API docs](references/api-guide.md)`

### 3.6 Progressive Disclosure

Skills are designed for efficient context window usage:

| Tier | Content | Token Cost | When Loaded |
|------|---------|------------|-------------|
| **Metadata** | `name` + `description` | ~100 tokens per skill | At startup for ALL installed skills |
| **Instructions** | Full SKILL.md body | < 5,000 tokens recommended | When the skill is activated |
| **Resources** | Files in `scripts/`, `references/`, `assets/` | Variable | Only when the agent explicitly needs them |

This three-tier model means a project can have dozens of skills installed with minimal context overhead — only the metadata tier loads at startup.

### 3.7 Invocation

Skills can be invoked in two ways:

- **Explicit**: User types `/skill-name` (slash command) or `@` mentions the skill
- **Implicit**: The agent automatically matches a task against skill descriptions and loads relevant skills via the `skill` tool

At runtime, OpenCode provides agents with a `skill` tool whose description includes an `<available_skills>` section listing all discovered skill names and descriptions. The agent calls the tool to load a skill's full content.

### 3.8 Skill Permissions

Skill access is controlled via permissions in `opencode.json` or agent frontmatter:

```json
{
  "permission": {
    "skill": {
      "*": "allow",
      "internal-*": "deny",
      "experimental-*": "ask"
    }
  }
}
```

| Permission | Behavior |
|------------|----------|
| `allow` | Skill loads immediately |
| `deny` | Skill hidden from agent entirely |
| `ask` | User prompted for approval before loading |

Per-agent overrides in agent frontmatter:

```yaml
---
permission:
  skill:
    "documents-*": allow
---
```

The entire skill tool can be disabled per-agent:

```yaml
---
tools:
  skill: false
---
```

### 3.9 Complete Skill Example

```
.opencode/skills/
└── git-release/
    ├── SKILL.md
    ├── scripts/
    │   └── changelog.sh
    └── references/
        └── semver-guide.md
```

`.opencode/skills/git-release/SKILL.md`:

```yaml
---
name: git-release
description: >
  Create consistent releases and changelogs. Use when preparing a tagged
  release, generating release notes, or determining version bumps.
license: MIT
compatibility: Requires git and gh CLI
metadata:
  author: my-team
  version: "1.0"
---

# Git Release Skill

## Instructions

1. Collect merged PRs since the last tag using `scripts/changelog.sh`
2. Categorize changes (features, fixes, breaking changes)
3. Propose a semver bump based on change types
   - See [semver guide](references/semver-guide.md) for rules
4. Draft release notes in Keep a Changelog format
5. Provide a copy-pasteable `gh release create` command

## Examples

- Input: "Prepare a release"
- Output: Categorized changelog + version recommendation + gh command

## Edge Cases

- If no PRs found since last tag, check for direct commits to main
- If no tags exist, treat as initial release (v1.0.0)
```

---

## 4. Agents

### 4.1 What Agents Are

Agents are specialized AI assistants configured for specific tasks. Each agent has a system prompt, model preference, tool access, and permissions. Agents define the **who** — which persona handles the work. There are two types: **primary agents** (user-facing, cycled via Tab) and **subagents** (invoked by primary agents or via `@` mention).

### 4.2 Directory Layout

Agents are defined as markdown files. The filename becomes the agent identifier (e.g., `reviewer.md` creates the `reviewer` agent).

| Location | Scope |
|----------|-------|
| `.opencode/agents/<name>.md` | Project-level |
| `~/.config/opencode/agents/<name>.md` | User-level (all projects) |

Claude Code compatible paths (`.claude/agents/`) are also supported by OpenCode for cross-tool portability.

### 4.3 Agent Frontmatter

All fields are optional except `description`.

```yaml
---
description: Reviews code for quality, security, and best practices
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
top_p: 0.9
steps: 50
hidden: false
color: "#3B82F6"
tools:
  write: false
  edit: false
  bash: false
  skill: true
permission:
  edit: deny
  bash:
    "*": ask
    "git diff": allow
    "git log*": allow
    "grep *": allow
  webfetch: deny
  skill:
    "code-*": allow
    "internal-*": deny
  task:
    "*": deny
    "reviewer": allow
---

You are a code reviewer. Focus on:

- Code quality and best practices
- Potential bugs and edge cases
- Performance implications
- Security considerations

Provide constructive feedback without making direct changes.
```

### 4.4 Frontmatter Reference

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `description` | **Yes** | string | What the agent does and when to use it. Used by other agents to decide when to delegate. |
| `mode` | No | `primary` \| `subagent` \| `all` | How the agent can be used. `primary` = main conversation agent. `subagent` = invoked by other agents or via `@`. `all` = both. Default: `all` |
| `model` | No | string | Model ID in `provider/model-id` format (e.g., `anthropic/claude-sonnet-4-20250514`). Primary agents default to the globally configured model. Subagents inherit the invoking primary agent's model. |
| `temperature` | No | number (0.0-1.0) | Controls response randomness. Lower = more deterministic. |
| `top_p` | No | number (0.0-1.0) | Alternative to temperature for controlling diversity. |
| `steps` | No | number | Max agentic iterations before forced text response. Unset = no limit. |
| `hidden` | No | boolean | Hide from `@` autocomplete menu. Agent can still be invoked programmatically via the Task tool. Only meaningful for `subagent` mode. Default: `false` |
| `color` | No | string | Hex color (`#FF5733`) or theme name (`primary`, `secondary`, `accent`, `success`, `warning`, `error`, `info`) |
| `tools` | No | `Record<string, boolean>` | Enable/disable specific tools. Supports wildcards: `mymcp_*: false`. Overrides global config. |
| `permission` | No | object | Per-tool permission overrides. See §4.5. |
| `disable` | No | boolean | Disable the agent entirely. |

**Pass-through options**: Any additional frontmatter fields not listed above are passed through directly to the provider as model options. This allows provider-specific parameters like `reasoningEffort`, `textVerbosity`, etc.

### 4.5 Permission Model

Permissions control what actions an agent can take. Three tools support granular permissions: `edit`, `bash`, and `webfetch`. Skills and task delegation have their own permission namespaces.

**Simple permissions** (tool-level):

```yaml
permission:
  edit: deny        # deny | allow | ask
  bash: allow
  webfetch: ask
```

**Granular bash permissions** (glob patterns, last matching rule wins):

```yaml
permission:
  bash:
    "*": ask            # Default: ask for all commands
    "git *": allow      # Allow all git commands
    "npm test": allow   # Allow npm test specifically
    "rm -rf *": deny    # Always deny destructive commands
```

**Skill permissions** (glob patterns):

```yaml
permission:
  skill:
    "*": allow
    "internal-*": deny
```

**Task delegation permissions** (glob patterns — controls which subagents this agent can invoke):

```yaml
permission:
  task:
    "*": deny                 # Deny all subagent invocations
    "reviewer": allow         # Except the reviewer
    "orchestrator-*": allow   # And anything prefixed orchestrator-
```

When a permission is set to `deny`, the denied item is removed from the tool description entirely so the model won't attempt to invoke it.

### 4.6 Agent Body (System Prompt)

The markdown body becomes the agent's system prompt. Write it as direct instructions to the AI:

```markdown
You are a security auditor. Focus on identifying potential security issues.

Look for:
- Input validation vulnerabilities
- Authentication and authorization flaws
- Data exposure risks
- Dependency vulnerabilities

Provide findings organized by severity: Critical, High, Medium, Low.
```

For long system prompts, use a file reference in JSON config:

```json
{
  "agent": {
    "build": {
      "prompt": "{file:./prompts/build.txt}"
    }
  }
}
```

### 4.7 Built-in Agents

OpenCode ships with these built-in agents:

| Agent | Mode | Purpose | Tool Access |
|-------|------|---------|-------------|
| **Build** | primary | Default development agent | All tools |
| **Plan** | primary | Analysis and planning without changes | Read-only (edit/bash set to `ask`) |
| **General** | subagent | Multi-step research and execution | All tools (except todo) |
| **Explore** | subagent | Fast read-only codebase exploration | Read-only (no write/edit) |

Built-in agents can be customized via `opencode.json`:

```json
{
  "agent": {
    "build": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.3
    },
    "plan": {
      "permission": {
        "bash": {
          "git diff": "allow"
        }
      }
    }
  }
}
```

### 4.8 Complete Agent Example

`.opencode/agents/security-auditor.md`:

```yaml
---
description: Performs security audits and identifies vulnerabilities. Use when reviewing code for security issues, checking for exposed secrets, or validating auth flows.
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.1
color: error
tools:
  write: false
  edit: false
permission:
  bash:
    "*": deny
    "grep *": allow
    "git log*": allow
    "git diff*": allow
  skill:
    "security-*": allow
---

You are a senior security engineer performing a code audit.

## Process

1. Identify the scope of the review (files, modules, or full repo)
2. Check for common vulnerability patterns (OWASP Top 10)
3. Review authentication and authorization logic
4. Check for exposed secrets, API keys, or credentials
5. Assess dependency security (known CVEs)
6. Review input validation and sanitization

## Output Format

Organize findings by severity:

### Critical
Issues that could lead to immediate exploitation.

### High
Issues that pose significant risk but require specific conditions.

### Medium
Issues that should be addressed but have limited impact.

### Low
Best practice improvements and defense-in-depth suggestions.

For each finding, include:
- **Location**: File path and line numbers
- **Issue**: Clear description of the vulnerability
- **Impact**: What could go wrong
- **Fix**: Specific remediation steps
```

---

## 5. Commands

### 5.1 What Commands Are

Commands are named prompt templates invoked via `/command-name`. They define reusable, parameterized prompts for repetitive tasks. Commands are simpler than skills — they don't have progressive disclosure, supporting files, or the Agent Skills spec's directory structure. Commands run the prompt immediately in the current or specified agent.

> **Note**: Claude Code has merged commands into the skills system. In OpenCode, commands and skills remain distinct mechanisms. When authoring for portability, prefer skills over commands for anything non-trivial.

### 5.2 Directory Layout

| Location | Scope |
|----------|-------|
| `.opencode/commands/<name>.md` | Project-level |
| `~/.config/opencode/commands/<name>.md` | User-level |

Claude Code compatible paths (`.claude/commands/`) are also read.

### 5.3 Command Frontmatter

```yaml
---
description: Run tests with coverage and suggest fixes
agent: build
model: anthropic/claude-sonnet-4-20250514
subtask: false
---
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `description` | No | string | Shown in the TUI when browsing commands |
| `agent` | No | string | Which agent executes this command. If the named agent is a subagent, the command triggers a subagent invocation by default. |
| `model` | No | string | Override model for this command |
| `subtask` | No | boolean | Force subagent invocation even if the agent's mode is `primary`. Useful for keeping the command's work out of the main context. |

### 5.4 Command Body (Prompt Template)

The markdown body is the prompt sent to the agent. It supports three types of dynamic content:

**Arguments** — `$ARGUMENTS` for all args, `$1`, `$2`, `$3` for positional:

```markdown
Create a new React component named $ARGUMENTS with TypeScript support.
```

```markdown
Create a file named $1 in directory $2 with content: $3
```

**Shell output** — `!`command`` preprocesses and injects output:

```markdown
Recent commits:
!`git log --oneline -10`

Review these changes and suggest improvements.
```

**File references** — `@filepath` injects file content:

```markdown
Review the component in @src/components/Button.tsx and suggest improvements.
```

### 5.5 Complete Command Example

`.opencode/commands/review-pr.md`:

```yaml
---
description: Review the current PR for quality and correctness
agent: plan
subtask: true
---

## Context

PR diff:
!`git diff main...HEAD`

Changed files:
!`git diff main...HEAD --name-only`

## Task

Review this pull request for:
1. Correctness — does the code do what it claims?
2. Edge cases — what could go wrong?
3. Style — does it follow project conventions?
4. Security — any obvious vulnerabilities?

Provide actionable feedback organized by severity.
```

---

## 6. Summary: Choosing Between Skills, Agents, and Commands

| Need | Use | Why |
|------|-----|-----|
| On-demand procedural knowledge an agent loads when relevant | **Skill** | Progressive disclosure, bundled scripts/references, portable via Agent Skills spec |
| A specialized AI persona with custom model, tools, and permissions | **Agent** | Defines who does the work, not what they know |
| A reusable prompt template for a repetitive action | **Command** | Simple, no directory structure needed, runs immediately |
| Domain expertise that multiple agents might need | **Skill** (loaded by any agent) | Skills are composable and agent-independent |
| A read-only analysis workflow | **Agent** with restricted tools | Permission model enforces constraints |
| A complex workflow with scripts and reference docs | **Skill** with `scripts/` and `references/` | Full directory structure for supporting resources |

---

## 7. Portability Notes

### What is portable across tools

- **Skills** following the Agent Skills spec (agentskills.io) work in Claude Code, OpenCode, Gemini CLI, Cursor, Amp, Codex, and 20+ other tools. This is the most portable format.
- **AGENTS.md** for project-level instructions is the universal standard (AAIF).
- **Markdown + YAML frontmatter** as a file format is understood by all tools.

### What is OpenCode-specific

- Agent `permission` with glob-based bash rules (Claude Code uses `permissionMode` instead)
- Agent `steps` field (Claude Code uses `maxTurns`)
- Agent `tools` as `Record<string, boolean>` (Claude Code uses comma-separated strings)
- Agent `hidden` field
- Command `subtask` field
- The `{file:./path}` prompt reference syntax

### What is Claude Code-specific (NOT included here)

- `disable-model-invocation` / `user-invocable` in skill frontmatter
- `context: fork` for running skills in subagent isolation
- `!`command`` preprocessing in skills (supported in commands by both tools, but only Claude Code supports it in skills)
- `permissionMode` (`acceptEdits`, `dontAsk`, `delegate`, `bypassPermissions`)
- `memory` field on agents
- `hooks` field on agents
- `skills` preloading field on agents
- `mcpServers` field on agents
- `disallowedTools` field on agents

### Cross-tool compatibility strategy

1. **Use `.opencode/` paths as primary**, with `.claude/` paths as fallbacks (OpenCode reads both)
2. **Include Claude Code extension fields** in skill frontmatter when needed — OpenCode ignores unknown fields
3. **Avoid OpenCode-specific agent frontmatter** (like glob permissions) in skills that need to be portable — skills are portable, agents generally are not
4. **Test skills against the Agent Skills spec** using `skills-ref validate ./my-skill`

# Research: Dynamic Prompt Composition

Research into how Oh My OpenCode (OmO) implements dynamic prompt composition, and what Hugo should adopt.

## Background

OmO is an OpenCode plugin that dynamically modifies the prompts agents and subagents receive based on user input, task context, and agent capabilities. This research maps the full architecture to inform Hugo's own context composition system.

## OmO's Dynamic Prompting Architecture

OmO operates through four layers, each injecting context at a different point in the prompt pipeline.

### Layer 1: Keyword Detection -> Message Injection

A `chat.message` hook intercepts every user message, runs regex patterns against the text, and prepends behavioral directives before the model sees it.

**Three keyword modes:**

| Mode | Trigger Pattern | Injected Directive |
|------|----------------|-------------------|
| `ultrawork` | `/\b(ultrawork\|ulw)\b/i` | Max precision directive + sets `variant: "max"` on message |
| `search` | Multi-language search keywords (find, locate, grep, etc.) | "MAXIMIZE SEARCH EFFORT" — launch parallel agents, use all search tools |
| `analyze` | Multi-language analysis keywords (analyze, investigate, etc.) | "ANALYSIS MODE" — gather context before acting, consult specialists if complex |

**How it works:**

1. User sends a message
2. `chat.message` hook fires
3. Keyword detector strips code blocks and system-reminder tags from the text
4. Runs three regex patterns against the cleaned text
5. For each match, collects the associated directive message
6. Prepends all directives to the user's text: `${directives}\n\n---\n\n${originalText}`
7. Model sees the modified text as the user message

**Smart filtering:**

- System-reminder content (`<system-reminder>` tags) is stripped before detection to prevent system messages from self-triggering modes
- Background task sessions are excluded entirely (prevents `[analyze-mode]` from triggering in subagent contexts)
- Non-main sessions only get `ultrawork` detection (search/analyze skipped)
- Planner agents never get `ultrawork` (filtered out)

**Model-aware routing (ultrawork only):**

Ultrawork has three different message variants based on context:
- Planner agents (prometheus, plan) get a planner-specific version
- GPT models get a GPT-optimized version
- Default (Claude) gets the Claude-optimized version

**Key files:**

- `src/hooks/keyword-detector/index.ts` — Hook registration and injection logic
- `src/hooks/keyword-detector/detector.ts` — Pattern matching and text extraction
- `src/hooks/keyword-detector/constants.ts` — Detector definitions
- `src/hooks/keyword-detector/search/default.ts` — Search pattern and message
- `src/hooks/keyword-detector/analyze/default.ts` — Analyze pattern and message
- `src/hooks/keyword-detector/ultrawork/` — Ultrawork with model-aware routing

### Layer 2: Skill Content -> System Prompt Injection

When `task(load_skills=["git-master", ...])` is called, skill templates are resolved and injected as the `system` parameter to `session.prompt()` or `session.promptAsync()`.

**Skill sources (merged at runtime):**

1. **Builtin skills** (5 hardcoded in TypeScript):
   - `playwright` — Browser automation via Playwright MCP
   - `agent-browser` — Browser automation via agent-browser CLI
   - `frontend-ui-ux` — Design-first UI/UX expertise
   - `git-master` — Git operations (commit, rebase, history search) with 1100+ line prompt
   - `dev-browser` — Browser automation with persistent page state

2. **Project-level skills**: `.opencode/skills/SKILL.md` files with YAML frontmatter
3. **User-level skills**: `~/.config/opencode/skills/SKILL.md` files

**Skill definition format:**

```typescript
interface BuiltinSkill {
  name: string
  description: string
  template: string        // The actual prompt content (can be 1000+ lines)
  license?: string
  compatibility?: string
  metadata?: Record<string, unknown>
  allowedTools?: string[] // Tool restrictions when skill is active
  agent?: string          // Restrict to specific agent
  model?: string          // Preferred model for this skill
  subtask?: boolean
  mcpConfig?: SkillMcpConfig // MCP server config (e.g., playwright)
}
```

Custom skills use markdown files with YAML frontmatter:

```yaml
---
name: my-skill
description: "What this skill does"
model: claude-opus-4-6
agent: sisyphus
allowed-tools: [bash, read, write]
mcp:
  server-name:
    command: npx
    args: ["@some/mcp-server"]
---
# Skill prompt content (markdown body)
```

**Prompt composition formula:**

```
system = [Plan Agent Prepend?] + [Skill Content?] + [Category Prompt Append?]
```

Implemented in `buildSystemContent()`:

```typescript
function buildSystemContent(input: BuildSystemContentInput): string | undefined {
  const parts: string[] = []
  if (planAgentPrepend) parts.push(planAgentPrepend)
  if (skillContent) parts.push(skillContent)
  if (categoryPromptAppend) parts.push(categoryPromptAppend)
  return parts.join("\n\n") || undefined
}
```

The composed `system` content is passed to the OpenCode SDK:

```typescript
// Sync delegation
session.prompt({ system: systemContent, parts: [...], model: ... })

// Async delegation
session.promptAsync({ system: systemContent, parts: [...], model: ... })
```

**Key files:**

- `src/features/builtin-skills/skills.ts` — Factory for builtin skills
- `src/features/builtin-skills/skills/*.ts` — Individual skill templates
- `src/features/opencode-skill-loader/loader.ts` — Filesystem skill discovery
- `src/features/opencode-skill-loader/skill-content.ts` — Skill merging and extraction
- `src/tools/skill/tools.ts` — The `skill` tool that agents call
- `src/tools/delegate-task/prompt-builder.ts` — System content composition
- `src/tools/delegate-task/executor.ts` — Passes system content to session.prompt()

### Layer 3: Dynamic Agent Prompt Construction

The primary agent's (Sisyphus/Atlas) own system prompt is built at startup from available agents, skills, categories, and tools. Not static markdown — runtime-generated.

**`dynamic-agent-prompt-builder.ts` constructs:**

- Key triggers section (from agent metadata: "External library mentioned -> fire librarian")
- Tool & agent selection table (with cost tiers: FREE/CHEAP/EXPENSIVE)
- Explore agent usage guide (when to use vs. direct tools)
- Librarian agent usage guide (external reference search)
- Delegation table (domain -> agent mapping)
- Category + skills delegation guide (all available categories and skills with descriptions)
- Oracle consultation guide (when to use, when not to)
- Hard blocks & anti-patterns

**Model-aware prompt selection:**

Atlas has two complete prompt variants:
- `agents/atlas/default.ts` — Claude-optimized (default)
- `agents/atlas/gpt.ts` — GPT-optimized (different structure/instructions)

At startup, the model is checked and the appropriate base prompt is selected, then dynamic sections are injected via string replacement:

```typescript
const basePrompt = getAtlasPrompt(model)
return basePrompt
  .replace("{CATEGORY_SECTION}", categorySection)
  .replace("{AGENT_SECTION}", agentSection)
  .replace("{{CATEGORY_SKILLS_DELEGATION_GUIDE}}", categorySkillsGuide)
```

**8 built-in categories (each with model + prompt append):**

| Category | Model | Domain |
|----------|-------|--------|
| `quick` | claude-haiku-4-5 | Trivial tasks, single file changes |
| `visual-engineering` | google/gemini-3-pro | Frontend, UI/UX, design, animation |
| `ultrabrain` | openai/gpt-5.3-codex | Hard logic-heavy tasks |
| `deep` | openai/gpt-5.3-codex | Goal-oriented autonomous problem-solving |
| `artistry` | google/gemini-3-pro | Creative, unconventional approaches |
| `writing` | google/gemini-3-flash | Documentation, prose, technical writing |
| `unspecified-low` | claude-sonnet-4-5 | Moderate effort, doesn't fit other categories |
| `unspecified-high` | claude-opus-4-6 | High effort, doesn't fit other categories |

Each category has a `prompt_append` that injects domain-specific behavioral instructions (mindset, constraints, execution guidelines).

**Key files:**

- `src/agents/dynamic-agent-prompt-builder.ts` — All section builders
- `src/agents/atlas/default.ts` — Claude-optimized base prompt
- `src/agents/atlas/gpt.ts` — GPT-optimized base prompt
- `src/agents/atlas/index.ts` — Model-aware prompt selection
- `src/agents/sisyphus.ts` — Sisyphus agent prompt with dynamic sections
- `src/tools/delegate-task/constants.ts` — Category definitions and prompt appends
- `src/tools/delegate-task/categories.ts` — Category config resolution

### Layer 4: Context Collector (Cross-Hook Injection)

A `ContextCollector` singleton allows any hook to register context entries with priority. Before the model processes a message, all collected context is merged and prepended to the last user message.

**How it works:**

1. Various hooks register context during the `chat.message` lifecycle:
   - `keyword-detector` — Search/analyze mode directives
   - `rules-injector` — Project rules
   - `directory-agents` — AGENTS.md content
   - `directory-readme` — README.md content
   - `custom` — Any hook can register

2. Each entry has a priority: `critical > high > normal > low`

3. Before the model sees the message, `experimental.chat.messages.transform` fires:
   - Collector merges all pending entries (sorted by priority)
   - Inserts a synthetic text part before the user's text in the last user message
   - Marks it `synthetic: true` (hidden in UI)
   - Consumes (clears) the pending entries

**The ContextCollector:**

```typescript
class ContextCollector {
  private sessions: Map<string, Map<string, ContextEntry>> = new Map()

  register(sessionID, { id, source, content, priority }): void
  getPending(sessionID): PendingContext    // sorted by priority
  consume(sessionID): PendingContext       // get + clear
  hasPending(sessionID): boolean
  clear(sessionID): void
}
```

**Context entry structure:**

```typescript
interface ContextEntry {
  id: string                          // Unique within source (for dedup)
  source: ContextSourceType           // "keyword-detector" | "rules-injector" | ...
  content: string                     // The actual context to inject
  priority: "critical" | "high" | "normal" | "low"
  timestamp: number
  metadata?: Record<string, unknown>
}
```

**Deduplication:** Entries are keyed by `${source}:${id}`. Re-registering the same key overwrites.

**Key files:**

- `src/features/context-injector/collector.ts` — ContextCollector class
- `src/features/context-injector/injector.ts` — Hook that performs injection
- `src/features/context-injector/types.ts` — Type definitions

## Additional Mechanisms

### Category-Skill Reminder System

A post-tool-use hook monitors orchestrator agents (Sisyphus/Atlas). After 3+ delegatable tool calls (edit, write, bash, read, grep, glob) without using `task()`, it injects a reminder about the category+skill system. This nudges the orchestrator to delegate instead of doing everything directly.

### Hook-Message Injector

Stores and retrieves message metadata (agent, model, tools) from disk. This allows resolving parent agent/model context for subagents across sessions. The `hook-message-injector` is a supporting utility, not a prompt composition mechanism itself.

### System Directives

OmO uses `<system-reminder>` tags for injected content. These tags are:
- Recognized by keyword detection (stripped before pattern matching)
- Used to wrap automated injections (background task notifications, todo reminders)
- Filtered so they don't trigger cascading mode activations

## OpenCode Plugin API Surface for Prompt Manipulation

Based on the research, these are the OpenCode plugin hooks relevant to prompt composition:

| Hook | When It Fires | What It Can Modify |
|------|--------------|-------------------|
| `chat.message` | Before each message is processed | `output.parts` (user message text), `output.message` (metadata like variant) |
| `experimental.chat.messages.transform` | Before message array is sent to model | Full `messages[]` array — can insert/modify/remove parts |
| `pre-tool-use` | Before a tool executes | Tool args, system message |
| `post-tool-use` | After a tool returns | Tool output, system message, continue flag |
| `session.prompt()` `system` param | When prompting a session | System-level instruction for that specific prompt |

**The `system` parameter on `session.prompt()`** is the primary mechanism for subagent prompt injection. It adds a system-level instruction alongside the agent's base prompt. This is how skill content reaches subagents.

## Analysis: What Hugo Should Adopt

### High Value, Direct Alignment with Hugo's Mission

**1. Context Collector Pattern (Layer 4)**

This maps directly to Hugo's "context composition" concept. A priority-based collector that assembles context from multiple sources into a coherent payload is exactly what Hugo needs for its snippet system.

Hugo's version could be:
- Global snippets (priority: normal)
- Phase-level snippets (priority: high)
- Task-specific snippets (priority: critical)
- Learnings/errors (priority: high)

All merged and injected before the model sees the task prompt.

**2. System Prompt Injection via `session.prompt({ system })` (Layer 2)**

This is the cleanest mechanism for delivering composed context to subagents. Hugo's context payloads would be assembled from snippets and passed as the `system` parameter.

### Medium Value, Consider for Hugo v1

**3. Keyword Detection (Layer 1)**

Lightweight behavioral steering. Hugo could detect task-relevant keywords to auto-select context scopes or adjust the composition strategy. Lower priority than the core snippet system.

**4. Skill-like Templates**

Hugo's "hierarchical plans with dedicated context documents" could function like skills — each task/phase has a context document that gets injected when that task is active. The skill loading pattern (frontmatter metadata + markdown body) is a good format reference.

### Lower Priority for Hugo

**5. Dynamic Agent Prompt Building (Layer 3)**

Only relevant if Hugo manages its own agent definitions. Since Hugo is a plugin alongside (not replacing) the agent system, this is less critical. Hugo's value is in context assembly, not agent prompt authoring.

**6. Category System**

Model routing by task domain. Useful but orthogonal to Hugo's core mission of context efficiency. Could be a future addition.

## Key Architectural Decisions for Hugo

1. **Composition happens at prompt time, not config time** — Context is assembled fresh for each task invocation, not baked into static configs.

2. **The `system` parameter is the injection point** — OpenCode's `session.prompt({ system })` is the cleanest way to deliver composed context to agents/subagents.

3. **Priority-based merging** — When multiple context sources contribute, priority ordering prevents information overload while ensuring critical context is always present.

4. **Deduplication by source+id** — Prevents duplicate context entries from accumulating across hooks/lifecycle events.

5. **Session-scoped state** — Context is tracked per-session, not globally. Each session has its own pending context queue.

## Open Questions

1. **How does Hugo's plan hierarchy map to context scopes?** Each phase and task needs its own context scope. The collector pattern supports this but the plan-to-scope mapping needs design.

2. **Token budgets** — OmO doesn't enforce token limits on injected context. Hugo's core value prop is efficiency, so it should have a budget system that truncates or prioritizes when context exceeds limits.

3. **Snippet lifecycle** — When are snippets created? By whom? Manually by the user, automatically by the agent during execution, or both?

4. **Persistence** — OmO's context collector is in-memory (cleared after injection). Hugo's snippets should persist across sessions as part of the plan artifacts.

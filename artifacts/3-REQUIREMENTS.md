# Requirements

## Platform

This system is built as an **OpenCode plugin**, leveraging OpenCode's native extension points: plugins, custom tools, agents, skills, and commands.

OpenCode provides:

- **Plugins** (`.opencode/plugins/`): JS/TS modules with lifecycle hooks (e.g., `experimental.session.compacting`, tool interception, event subscriptions).
- **Custom Tools** (`@opencode-ai/plugin`): Typed tools with Zod schemas that become available to the LLM alongside built-in tools.
- **Agents**: Configurable agents with dedicated system prompts, tool permissions, and model assignments. Can be primary agents or subagents.
- **Skills**: `SKILL.md` files that can be loaded into context on demand via the built-in skill tool.
- **Commands**: Templated prompt shortcuts for repetitive tasks.
- **MCP Servers**: External tool/service integrations via Model Context Protocol.
- **Compaction Hooks**: Ability to inject custom context into session compaction summaries.
- **Session Management**: Persistent sessions with SQLite storage.

The system should maximize use of these native capabilities before introducing external dependencies.

---

## Hard Requirements

These are non-negotiable capabilities the system must support.

### R1: Agents

The system must support **custom agents** with distinct roles, system prompts, tool access, and model configurations. Agents must be definable through OpenCode's native agent configuration. The system should support both primary agents and subagents.

### R2: Skills

The system must support **skills** — loadable instruction sets that teach agents how to perform specific types of work. Skills serve as reusable knowledge that can be composed into an agent's context on demand.

The system requires two categories of skills:

- **System skills**: Skills that define how to use the system itself — how to read and write context documents, how to follow the planning hierarchy, how to perform handoffs, how to use context composition tools. These are the system's own operating manual, delivered as skills.
- **Domain skills**: Skills that define how to perform specific technical or creative tasks — coding patterns, testing strategies, documentation standards, architectural conventions. These may be user-provided, project-specific, or installed from a shared repository.

Skills must be implementable as OpenCode `SKILL.md` files that agents can load via the built-in skill tool. The system should provide a convention for organizing and discovering skills.

### R3: Custom Tools

The system must expose its core capabilities as **custom tools** available to agents. At minimum:

- **Context tools**: Read, create, update, and compose context snippets. Query available context by scope (global/local) and relevance.
- **Planning tools**: Read and update the task hierarchy. Mark tasks as complete. Retrieve the next task and its associated context.
- **Handoff tools**: Capture session outputs, persist findings, and prepare context for the next session/task.
- **Retrieval tools**: Efficiently locate relevant code, files, or documentation without reading entire files or directories.

All tools must be implemented using `@opencode-ai/plugin`'s `tool()` helper with proper Zod schemas and descriptions so that agents can discover and use them effectively.

### R4: Hierarchical Planning

The system must support a **hierarchical plan structure** that decomposes work into phases and tasks. Each level of the hierarchy must support associated context documents. The planning system must:

- Represent plans as a structured, persistent artifact (not just conversation history).
- Support sequential ordering of tasks within phases.
- Track task status (pending, in-progress, complete, blocked, revision-needed).
- Associate each task with a dedicated folder containing scoped context documents.
- Allow plans to be revised without losing completed work.

### R5: Context Management

The system must implement a **structured context management system** that minimizes token waste while maintaining sufficient information for high-quality output. This includes:

- **Context snippets**: Compact, curated pieces of information with defined scope (global or local to a task/phase).
- **Context composition**: The ability to assemble a tailored context payload for a given task by combining relevant global snippets, phase-level context, and task-specific context.
- **Context lifecycle**: Creation, update, deprecation, and cleanup of context documents as work progresses.

### R6: Session Continuity

The system must support **structured session boundaries** so that work can be paused and resumed across OpenCode sessions without significant context loss. This includes:

- Leveraging OpenCode's compaction hooks to inject system-relevant context into compaction summaries.
- Producing handoff artifacts at session/task boundaries that allow a new session to resume efficiently.
- Minimizing the "cold-start tax" when a new session begins by pre-composing the necessary context payload.

---

## Soft Requirements

These are strongly desired but may be deferred or simplified in early iterations.

### S1: Continual Learning

The system should be capable of capturing errors, patterns, and insights during execution and recording them in dedicated documents. These findings should inform future task context and potentially feed back into skill refinement.

### S2: Context Composition Commands

The system should support user-definable **commands** (leveraging OpenCode's command system) that trigger specific context aggregation routines. For example, a `/prepare-task` command that assembles and presents the full context payload for the next task in the plan.

### S3: Extensibility

The system's architecture should make it easy to add new agents, skills, tools, and context sources without modifying the core plugin. Conventions and file structures should be self-documenting so that users can extend the system by following patterns rather than reading implementation code.

### S4: Metrics and Observability

The system should track token usage, context payload sizes, and task completion rates to provide feedback on efficiency. This data can inform iterative improvements to context document design and planning granularity.

### S5: Version Control Integration

Context documents, plans, and skills should live in the project repository and be version-controlled alongside code. The system should produce artifacts that are human-readable and diffable.

---

## Constraints

- **OpenCode-native first**: Prefer OpenCode's built-in extension points over external infrastructure. Avoid introducing databases, servers, or services beyond what OpenCode already provides (SQLite, filesystem, MCP).
- **Filesystem-based state**: Plans, context documents, snippets, and skills should be stored as files in the project directory — readable, editable, and version-controllable by humans.
- **Model-agnostic**: The system should work with any model provider supported by OpenCode. Context management strategies should not depend on specific context window sizes.
- **Progressive adoption**: Users should be able to adopt pieces of the system incrementally. Using just the planning tools without the full context management system should still be valuable.

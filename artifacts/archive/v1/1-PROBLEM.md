# Building a Context-Efficient Agentic System

## The Problem

Working with current AI models and agentic tooling is deeply inefficient. The core issue is **context management** — how information is gathered, maintained, and carried across sessions. This inefficiency cascades into secondary problems: wasted tokens, degraded output quality, and poor planning. Below is a breakdown of the key frustrations.

### 1. Wasteful Context Gathering

LLMs are extremely liberal in how they consume context. They read entire files when they need a few lines. They browse full directories when they need a single function signature. This profligacy burns through token budgets quickly and, worse, dilutes the model's attention with irrelevant information — likely contributing to lower-quality output.

### 2. Context Degradation Across Long Sessions

As conversations grow longer, performance degrades. Context compaction (summarizing prior conversation to free up the context window) is lossy and unreliable. In practice, it's often better to start a fresh session than to continue a long one. But this creates its own problem — see below.

### 3. The Cold-Start Problem (Context Aggregation)

Every new session requires bringing the model back up to speed. This means feeding it planning documents, code files, prior decisions, and project state. The model then consumes all of this context — often reading far more than it needs — just to get oriented. This "cold-start tax" is paid repeatedly, sometimes every few prompts, and represents a massive cumulative waste of tokens and time.

### 4. Poor Output Quality

Even the most advanced models frequently produce work that is poorly planned, sloppily implemented, or subtly broken. This is partly a function of the context problems above — a model swimming in loosely relevant information is less likely to produce focused, high-quality work. But it also reflects a lack of structured guidance. Without detailed, specific instructions, models tend to take shortcuts and make assumptions that lead to bugs and unintended consequences.

### 5. Inadequate Planning Frameworks

Effective AI-assisted work requires highly detailed, atomized plans — especially when work spans multiple sessions. But current tooling offers little support for this. There's no built-in mechanism for breaking large tasks into well-scoped subtasks, tracking progress across sessions, or ensuring that each session starts with exactly the context it needs. Planning is left entirely to the user, and the overhead of maintaining plans manually is substantial.

---

## The Vision

The ideal system would treat **context efficiency** and **structured planning** as first-class concerns, not afterthoughts. Every design decision should serve the goal of giving the model exactly what it needs — no more, no less — at every point in a workflow.

### Core Principles

1. **Minimal, sufficient context.** The system should never feed the model an entire file when a targeted snippet will do. Context should be precise, pre-composed, and purpose-built for the task at hand. Context should be sharded and organized where possible to enable efficient composition.

2. **Structured workflows over freeform conversation.** Rather than relying on open-ended chat, the system should guide work through a defined workflow where each step has clear inputs, outputs, and context requirements.

3. **Intelligent context composition.** The system should maintain a library of reusable and scoped (global vs. local) "context snippets" — compact, curated pieces of information (function signatures, architectural decisions, interface contracts, prior conclusions) that can be assembled on demand to orient the model for a specific task.

4. **Hierarchical planning with context scoping.** Large tasks should be decomposed into a hierarchy of subtasks, each with its own scoped context document/s. This serves two purposes: it keeps each individual task focused and tractable, and it means each session only needs to load the context relevant to its specific subtask — not the entire project.

5. **Efficient retrieval over brute-force reading.** The system should use targeted retrieval (CLI tools, indexed search, structured metadata) to locate relevant information rather than having the model grep through files or read entire directories.

### How It Would Work

- **Pre-Planning phase:** The tool discusses directly with the user what their goals are. This informs the system what degree of pre-planning work is necessary (clarification, definitions, PRD, needed context, preferences, skills needed etc.). Global context snippets can be created during this time. Agents and skills can be created/installed during this time.

- **Context composition commands:** The system is extensible, and it is easy to define context aggregation commands that fetch and compose necessary context for the different execution jobs that will be required.

- **Planning phase:** The goal is broken down into a hierarchical plan consisting of phases and tasks that are sequentially ordered intelligently. Each task has a dedicated folder containing a number of context documents associated with that task.

- **Context composition:** When a session begins, the system assembles a tailored context payload from the relevant snippets and planning documents. The model receives a focused, pre-digested briefing rather than a pile of raw files.

- **Execution:** The model works within its scoped task, guided by the plan. It has access to efficient retrieval tools for anything not in its initial context, but it shouldn't need to use them often because the context was well-composed.

- **Handoff:** When a task is complete (or a session ends), the system captures outputs, updates planning state, and finalizes context documents before the next session starts. The cold-start tax for the next session is minimal because the handoff was structured.

- **Continual learning:** During execution, the system is capable of picking up on errors, reporting findings in dedicated documents and recommending fixes later.

### What This Enables

- **Dramatically fewer wasted tokens** on context gathering and re-orientation.
- **Higher quality output** because the model is working with focused, relevant context and clear, specific instructions.
- **Seamless multi-session workflows** where progress carries forward cleanly instead of being lost or expensively reconstructed.
- **Scalability to larger projects** that would currently collapse under the weight of context management overhead.

---

## Open Questions

- What is the right format and granularity for context snippets? How do you balance compactness with completeness?
- How much of the planning decomposition can be automated (i.e., done by the AI itself) vs. requiring human judgment?
- How should the system handle cases where a task's context requirements turn out to be wrong or incomplete mid-session?
- What's the right interface? CLI tool? IDE plugin? Standalone application?
- How does this integrate with existing version control and project management workflows?

# Hugo

An OpenCode plugin for context-efficient agentic workflows.

Hugo gives AI agents exactly the context they need — no more, no less. It replaces the brute-force pattern of reading entire files and directories with structured context management: curated snippets, hierarchical plans, and scoped context composition that minimize token waste while maximizing output quality.

## The Problem

Working with AI agents is deeply inefficient. Models read entire files when they need a few lines. Every new session requires expensive re-orientation. Context compaction is lossy. Planning is left entirely to the user. The result: wasted tokens, degraded output quality, and workflows that collapse at scale.

## What Hugo Does

- **Hierarchical Planning** — Decomposes work into phases and tasks, each with dedicated context documents. Plans are persistent, structured artifacts — not conversation history.
- **Context Snippets** — Compact, curated pieces of information scoped globally or locally to a task. Assembled on demand to orient the model for specific work.
- **Context Composition** — Assembles tailored context payloads per task by combining global, phase-level, and task-specific snippets. The model receives a focused briefing, not a pile of raw files.
- **Continual Learning** — Captures errors and insights during execution, feeding them back into future task context.

## Status

Early development. See `artifacts/` for design documents and planning.

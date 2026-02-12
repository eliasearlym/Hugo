# Hugo Directory & File Map

What `hugo-init` scaffolds and what gets created during each scenario.

---

## Directory Structure

```
.hugo/
├── global/
│   └── overview.md
└── plan/
```

Everything below describes what each file/directory is, when it's created, and what it looks like.

---

## `.hugo/global/`

Global context snippets. Static, slow-changing information that applies across all tasks. Plain markdown, no frontmatter.

### `overview.md`

A single detailed paragraph (120 words or less) that describes what the software does or what the developer is planning to build. This is the most fundamental piece of context — it orients the model on the purpose and nature of the project. Should be specific enough that someone unfamiliar with the project could understand its intent and scope after reading it.

```
# Overview

Hugo is a plugin for OpenCode that helps developers plan, execute, and resume large coding projects across multiple sessions without losing context. It breaks work into phases and tasks, keeps track of what the AI needs to know for each task, and handles the handoff between sessions so you can pick up where you left off. Everything is stored as plain markdown files in the project directory.
```

---

## `.hugo/plan/`

Empty at init. Populated during S03 (planning/task decomposition).

When populated:

```
.hugo/plan/
├── plan.md                          # Plan overview — phases, ordering, status
└── phases/
    ├── Phase-1/
    │   ├── phase.md                 # Phase description and context
    │   └── tasks/
    │       ├── Task-1.1/
    │       │   └── task.md          # Task description, instructions, scoped context
    │       └── Task-1.2/
    │           └── task.md
    └── Phase-2/
        ├── phase.md
        └── tasks/
            └── ...
```

### `plan.md`

Top-level plan document. Lists phases and tasks in order. Each phase and task has a minimal, general description.

### `phase.md`

Phase-level context. Describes the phase's goal and any context shared across its tasks.

### `task.md`

Task-level scoped context. Everything the model needs to execute this specific task — instructions, relevant code locations, decisions, constraints.

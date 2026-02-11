
# Scenario: [Short Descriptive Name]

> **One-line summary:** [What is happening and why]

## Entry Conditions

- **User state:** [What the user has, knows, or has decided at this point]
- **System state:** [What exists on disk — `.hugo/` files, plan status, indexes, etc.]
- **Trigger:** [What initiates this scenario — a command, a system event, a session start, etc.]

## Context Flow

What context is consumed and produced by this scenario.

- **Reads:** [What existing context documents, indexes, or state the system needs to read]
- **Writes:** [What context documents, state, or artifacts the system produces or updates]

## Walkthrough

Step-by-step narrative. Each step indicates who acts (user or system) and what happens. Steps should be concrete enough to imply what needs to be built.

### Step 1: [Short label]

**[User | System]** — [What happens and how. What the system reads, computes, presents, or writes. What the user provides or decides.]

### Step 2: [Short label]

**[User | System]** — [...]

<!-- Repeat as needed -->

## Exit Conditions

- **User state:** [What the user now has, knows, or has decided]
- **System state:** [What now exists on disk — new files, updated plans, status changes, etc.]
- **Next scenario:** [What scenario/s typically follow this one]

## Edge Cases

| Situation | System Response |
|---|---|
| [e.g., User provides vague input] | [e.g., System asks clarifying questions] |

## What This Scenario Requires

Everything this scenario implies we need to build. Extracted directly from the walkthrough.

### Commands

User-facing commands or entry points that trigger or participate in this scenario.

| Command | Description |
|---|---|
| [e.g., `/hugo-init`] | [Bootstraps project structure] |

### Tools

Capabilities the system needs, exposed as tools available to agents.

| Tool | Description |
|---|---|
| [e.g., `compose_context(task_id)`] | [Assembles context payload for a task] |

### Agents

Agents that participate in this scenario and their roles.

| Agent | Role |
|---|---|
| [e.g., Planner] | [Decomposes goal into phases and tasks] |

### Skills

Skills that agents need loaded to perform their work in this scenario.

| Skill | Purpose |
|---|---|
| [e.g., `hugo-planning`] | [Teaches agent how to create and structure Hugo plans] |

## Notes

Open questions, design tensions, or observations.

- [...]

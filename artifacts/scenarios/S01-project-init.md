
# Scenario: Project Initialization

> **One-line summary:** User opens OpenCode with Hugo installed for the first time in a project directory, and the system bootstraps the `.hugo/` structure.

## Entry Conditions

- **User state:** Has a project directory (possibly with existing code, possibly empty). Has Hugo installed as an OpenCode plugin. Has not previously initialized Hugo in this directory.
- **System state:** No `.hugo/` directory exists in the project root. OpenCode is running with Hugo plugin loaded.
- **Trigger:** Either the system detects no `.hugo/` directory on session start and asks the user, or the user explicitly runs `/hugo-init`.

## Context Flow

- **Reads:** The project directory (to detect whether a codebase exists). If a codebase exists, TLDR indexes it.
- **Writes:** `.hugo/` directory structure: `.hugo/global/overview.md`, `.hugo/plan/` (empty)

## Walkthrough

### Step 1: Detection

**System** — On session start, checks if `.hugo/` exists in the project root. If it does, this scenario doesn't apply (see S07 for resume). If it doesn't, the system asks the user if they'd like to initialize Hugo for this project.

### Step 2: User confirms

**User** — Confirms they want to initialize. If the user declines, the system does nothing and operates as vanilla OpenCode.

### Step 3: Scaffold directory structure

**System** — Creates the `.hugo/` directory structure:
```
.hugo/
├── global/
│   └── overview.md    (blank template)
└── plan/              (empty)
```

### Step 4: Detect existing codebase

**System** — Checks if the project directory contains an existing codebase (looks for source files, package manifests, config files — anything beyond an empty directory). If no codebase is detected, skip to Step 6.

### Step 5: Index codebase with TLDR

**System** — Runs `tldr warm .` to build the structural index. This creates the `.tldr/` directory with AST analysis, call graphs, and semantic embeddings. The index is queryable infrastructure for later scenarios — nothing is written to `.hugo/` from this step.

### Step 6: Draft overview

**System** — Asks the user to describe what they're building (or what this project does, if it already exists). The system may use TLDR's structural analysis to suggest a draft if a codebase exists. The user reviews, edits, and confirms. The result is written to `.hugo/global/overview.md` as a single paragraph, 120 words or less.

### Step 7: Initialization complete

**System** — Confirms initialization is complete and tells the user what was created. Indicates the next step: pre-planning (S02) to clarify goals before creating a plan.

## Exit Conditions

- **User state:** Understands Hugo is set up and ready. Has written or approved the project overview.
- **System state:** `.hugo/` directory exists with `global/overview.md` populated and `plan/` empty. If a codebase existed, TLDR index is built (`.tldr/`).
- **Next scenario:** S02 (Pre-Planning / Discovery)

## Edge Cases

| Situation | System Response |
|---|---|
| `.hugo/` already exists | Skip this scenario entirely — treat as S07 (session resume) |
| User declines initialization | System does nothing. Operates as vanilla OpenCode. |
| TLDR is not installed | Warn the user that codebase indexing is unavailable. Proceed with init without indexing. |
| TLDR indexing fails (unsupported language, corrupt files) | Warn the user, proceed without index. Indexing can be retried later. |
| User doesn't want to write an overview yet | Allow skip. `overview.md` is created as a blank template. Warn that context quality will be reduced without it. |
| Project is a monorepo | Open question — does Hugo init at the repo root or per-package? |

## What This Scenario Requires

### Commands

| Command | Description |
|---|---|
| `/hugo-init` | Explicit trigger to bootstrap `.hugo/` structure. Also runs automatically on session start if no `.hugo/` found (with user confirmation). |

### Tools

| Tool | Description |
|---|---|
| `init_project(path)` | Creates `.hugo/` directory structure with blank templates |
| `detect_codebase(path)` | Checks if the directory contains an existing codebase |
| `write_overview(content)` | Writes content to `.hugo/global/overview.md` |

### Agents

| Agent | Role |
|---|---|
| Hugo (primary) | Guides the user through initialization, asks questions, writes overview |

### Skills

| Skill | Purpose |
|---|---|
| `hugo-system` | Teaches the primary agent about Hugo's directory structure, file conventions, and what each artifact is for — so it knows what to create and why |

## Notes

- The init flow should feel lightweight, not like filling out a form. One command, a couple of questions, done.
- The overview is the only content artifact produced here. Everything else (plan, task context) comes later in S02/S03.
- TLDR indexing could take 30-60 seconds for large projects. The system should indicate progress rather than appearing frozen.
- Open question: should init also set up `.tldrignore` with sensible defaults, or leave that to TLDR's own behavior?
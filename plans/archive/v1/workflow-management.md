# Plan: Workflow Package Manager

Hugo manages workflows as installable packages. A workflow is a package (npm registry or git repo) containing agents, skills, commands, and a manifest. Hugo adds them to `.opencode/package.json`, lets bun handle versioning and resolution, then copies the relevant files from `node_modules/` into `.opencode/` where OpenCode discovers them natively. Hugo tracks what it copied via `state.json` (content hashes, source info, file ownership). Local edits are never overwritten — Hugo warns and skips.

## Architecture

```
Workflow npm package (@some-org/code-review-workflow):
  package.json                 # standard npm package
  hugo-workflow.json           # Hugo manifest — declares what to copy
  agents/
    orchestrator.md
    reviewer.md
  skills/
    git-diff/
      SKILL.md
      scripts/get-diff.sh
  commands/
    review-pr.md
    check-coverage.md

After `hugo i @some-org/code-review-workflow` (npm registry)
  or  `hugo i github:org/code-review-workflow` (git repo):

  .opencode/
    package.json               ← dependency added (package name or git URL)
    bun.lockb                      ← bun lockfile
    node_modules/
      @some-org/
        code-review-workflow/  ← installed by bun
          hugo-workflow.json
          agents/
          skills/
          commands/
    agents/
      orchestrator.md          ← copied from node_modules by Hugo
      reviewer.md
    skills/
      git-diff/
        SKILL.md
        scripts/get-diff.sh
    commands/
      review-pr.md             ← copied from node_modules by Hugo
      check-coverage.md
    state.json                 ← tracks what was copied, content hashes, source package
```

Bun handles versioning, dependency resolution, and authentication. It supports both npm registry packages and git URLs natively. Hugo handles the file copying from `node_modules/` to `.opencode/` and local edit detection. OpenCode discovers agents, skills, and commands from `.opencode/` natively.

---

## Phase 1: Workflow Manifest Format

**Goal:** Define what a workflow npm package looks like and how Hugo reads it.

### Task 1.1: Define the manifest schema

The manifest file `hugo-workflow.json` lives at the root of the npm package (alongside `package.json`). It declares what Hugo should copy into `.opencode/`:

```json
{
  "name": "code-review",
  "description": "Structured multi-pass code review workflow",
  "agents": [
    { "path": "agents/orchestrator.md" },
    { "path": "agents/reviewer.md" }
  ],
  "skills": [
    { "path": "skills/git-diff" },
    { "path": "skills/code-analysis" }
  ],
  "commands": [
    { "path": "commands/review-pr.md" },
    { "path": "commands/check-coverage.md" }
  ]
}
```

Design decisions:
- `path` is relative to the package root. Hugo uses these to know what to copy from `node_modules/`.
- Agents are individual `.md` files. Skills are directories (containing `SKILL.md` + optional `scripts/`, `references/`, `assets/`). Commands are individual `.md` files.
- No `version` field in the manifest — the npm package's `package.json` version is the source of truth.
- No dependency system between workflows for v1. Each workflow installs independently.

### Task 1.2: Define the types

Create `src/workflows/types.ts`:

```typescript
type WorkflowManifest = {
  name: string;
  description: string;
  agents: Array<{ path: string }>;
  skills: Array<{ path: string }>;
  commands: Array<{ path: string }>;
};

type InstalledFile = {
  source: string;           // relative path in the package (e.g. "agents/reviewer.md")
  destination: string;      // relative path in .opencode/ (e.g. "agents/reviewer.md")
  hash: string;             // SHA-256 content hash at install/sync time
};

type PackageSource =
  | { type: "registry"; name: string }           // npm registry: "@some-org/code-review-workflow"
  | { type: "git"; url: string; ref?: string };   // git: "github:org/repo", "git+ssh://...", with optional tag/branch/commit

type WorkflowEntry = {
  name: string;             // workflow name (from manifest)
  source: PackageSource;    // where the package came from
  version: string;          // semver from registry, or commit hash from git
  syncedAt: string;         // ISO timestamp of last sync
  files: InstalledFile[];   // every file copied by Hugo
};

type WorkflowState = {
  workflows: WorkflowEntry[];
};

```

### Task 1.3: Implement manifest parser

Create `src/workflows/manifest.ts`:

- `parseManifest(jsonContent: string): WorkflowManifest` — parse and validate the JSON
- Validate required fields exist, paths don't escape the package root (no `../`), agent paths end in `.md`, command paths end in `.md`, skill paths are directories
- Throw clear errors for malformed manifests

---

## Phase 2: Install Command

**Goal:** `hugo i <package>` adds a workflow to `.opencode/package.json`, installs it via bun, and copies its contents into `.opencode/`. The package spec can be an npm package name or a git URL.

### Task 2.1: Implement bun integration

Create `src/workflows/bun.ts`:

- `addDependency(opencodeDir: string, packageSpec: string): Promise<void>` — run `bun add <spec>` in `.opencode/` (creates `package.json` if it doesn't exist). The `packageSpec` can be an npm package name (`@some-org/workflow`), a git URL (`github:org/repo`), or a git URL with ref (`github:org/repo#v1.0.0`). Bun handles all three natively.
- `runInstall(opencodeDir: string): Promise<void>` — run `bun install` in `.opencode/` via Bun shell (`$`)
- `runUpdate(opencodeDir: string, packageSpec?: string): Promise<void>` — run `bun update [spec]` in `.opencode/`
- `removeDependency(opencodeDir: string, packageSpec: string): Promise<void>` — run `bun remove <spec>` in `.opencode/`
- `getPackageDir(opencodeDir: string, packageName: string): string` — resolve the path to the package in `node_modules/`

**Source resolution** — `parsePackageSpec(spec: string): PackageSource`:
- Starts with `github:`, `git+ssh://`, `git+https://`, `git://` → `{ type: "git", url, ref }`
- Looks like a GitHub shorthand (`org/repo`, `org/repo#tag`) → `{ type: "git", url: "github:org/repo", ref }`
- Everything else → `{ type: "registry", name: spec }`

**Version resolution** — `getInstalledVersion(packageDir: string, source: PackageSource): string`:
- For registry sources → read `version` from the package's `package.json`
- For git sources → read `_resolved` or `gitHead` from the package's `package.json` (commit hash), or fall back to `version` field

### Task 2.2: Implement file copier

Create `src/workflows/sync.ts`:

- `syncWorkflow(packageDir: string, manifest: WorkflowManifest, opencodeDir: string, state: WorkflowState): Promise<SyncResult>`
- For each agent in manifest: copy `.md` file to `<opencodeDir>/agents/`
- For each skill in manifest: copy entire skill directory to `<opencodeDir>/skills/`
- For each command in manifest: copy `.md` file to `<opencodeDir>/commands/`
- Compute SHA-256 content hash for every file copied
- Return the list of `InstalledFile` entries and any warnings

Conflict detection before copying:
- If a destination file already exists and belongs to a different workflow (check `state.json`), abort with error: "File `agents/reviewer.md` already exists from workflow `other-workflow`. Remove that workflow first."
- If a destination file exists and belongs to no workflow (not in `state.json`), warn: "File `agents/reviewer.md` already exists and is not managed by Hugo. Skipping."
- If a destination file exists and belongs to the same workflow, check if locally modified (hash mismatch). If modified → skip and warn. If clean → overwrite with new version.

### Task 2.3: Implement workflow state management

Create `src/workflows/state.ts`:

- `readWorkflowState(opencodeDir: string): Promise<WorkflowState>` — read `state.json`, return empty structure if missing
- `writeWorkflowState(opencodeDir: string, state: WorkflowState): Promise<void>` — write atomically
- `addEntry(state: WorkflowState, entry: WorkflowEntry): WorkflowState` — add or replace by source
- `removeEntry(state: WorkflowState, name: string): WorkflowState` — remove by workflow name
- `findFileOwner(state: WorkflowState, relativePath: string): WorkflowEntry | null` — which workflow owns a given file

### Task 2.4: Wire up the install command

Create `src/commands/install.ts`:

The full install flow:
1. Parse the package spec to determine source type (registry or git)
2. Run `addDependency(opencodeDir, packageSpec)` — adds to `package.json` and installs via bun
3. Resolve package directory in `node_modules/`
4. Read and parse `hugo-workflow.json` from the package
5. Resolve installed version (semver for registry, commit hash for git)
6. Read existing `state.json`
7. Check for conflicts
8. Copy files to `.opencode/agents/`, `.opencode/skills/`, `.opencode/commands/`
9. Compute hashes for all copied files
10. Create workflow entry with source, version, timestamp, file list
11. Write updated `state.json`
12. Report: "Installed workflow `code-review` v1.0.0 (2 agents, 2 skills, 2 commands)"

Examples:
```bash
hugo i @some-org/code-review-workflow          # npm registry
hugo i @some-org/code-review-workflow@^2.0.0   # npm registry, version range
hugo i github:org/code-review-workflow         # git, latest default branch
hugo i github:org/code-review-workflow#v1.0.0  # git, pinned tag
hugo i git+ssh://git@github.com:org/repo.git   # git, explicit SSH URL
```

---

## Phase 3: Local Edit Detection

**Goal:** Hugo can detect when a user has modified installed files, and never overwrites them.

### Task 3.1: Implement hash comparison

Create `src/workflows/integrity.ts`:

- `checkIntegrity(opencodeDir: string, entry: WorkflowEntry): Promise<FileStatus[]>` — for each file in the entry, compare current content hash against the stored hash
- Return status per file: `clean`, `modified`, or `deleted`
- A file is `modified` if it exists but its hash differs from `state.json`
- A file is `deleted` if it no longer exists on disk

```typescript
type FileStatus = {
  file: InstalledFile;
  status: "clean" | "modified" | "deleted";
};
```

### Task 3.2: Implement status command

Create `src/commands/status.ts`:

- For each installed workflow, run integrity check
- Report:

```
Workflow: code-review v1.0.0 (@some-org/code-review-workflow)
  agents/orchestrator.md       clean
  agents/reviewer.md           modified
  skills/git-diff/SKILL.md     clean
  skills/git-diff/scripts/     clean
  commands/review-pr.md        clean
  commands/check-coverage.md   deleted
```

---

## Phase 4: Update Command

**Goal:** `hugo update [package-name]` runs `bun update`, detects what changed in `node_modules/`, and re-syncs files — skipping locally modified ones.

### Task 4.1: Implement update flow

Create `src/commands/update.ts`:

The update flow:
1. Run `bun update` in `.opencode/` (or `bun update <package>` for a specific workflow)
2. For each installed workflow in `state.json`:
   a. Read the package's current version from `node_modules/` — compare against stored version
   b. If version unchanged, skip
   c. If version changed, re-read `hugo-workflow.json` from the updated package
   d. Run integrity check on currently installed files
   e. For each file in the updated manifest:
      - If locally modified → **skip and warn**: "Skipping `agents/reviewer.md` — locally modified"
      - If locally deleted → **skip and warn**: "Skipping `agents/reviewer.md` — locally deleted"
      - If clean → compare content from `node_modules/` against installed content. If different, overwrite and update hash. If same, skip.
       - If new (not in current `state.json`) → copy and add
   f. If a file was removed from the manifest but exists locally and is clean → delete it. If modified → warn and leave.
3. Update `state.json` entries with new versions, timestamps, and file lists
4. Report summary:

```
Updated code-review: v1.0.0 → v1.1.0
  Updated: agents/orchestrator.md
  Skipped: agents/reviewer.md (locally modified)
  Added:   commands/lint-check.md
  Removed: (none)
```

---

## Phase 5: List and Remove Commands

**Goal:** Users can see what's installed and cleanly remove workflows.

### Task 5.1: Implement list command

Create `src/commands/list.ts`:

- Read `state.json`
- For each workflow, show: name, package, version, sync date, file counts
- Quick format:

```
Installed workflows:
  code-review  v1.0.0  @some-org/code-review-workflow  (2 agents, 2 skills, 2 commands)
  ci-pipeline  v2.1.0  @some-org/ci-pipeline-workflow   (1 agent, 3 skills, 1 command)
```

### Task 5.2: Implement remove command

Create `src/commands/remove.ts`:

- `hugo remove <package-name>`
- Read `state.json`, find the entry
- For each file in the entry:
  - If locally modified → warn: "Leaving `agents/reviewer.md` — locally modified. Delete manually if desired."
  - If clean → delete the file
  - If it's in a skill directory and the directory is now empty → remove the directory
- Remove the entry from `state.json`
- Remove the package from `.opencode/package.json` via `bun remove`
- Write updated `state.json`
- Report: "Removed workflow `code-review`. 1 file left in place (locally modified)."

---

## Phase 6: Plugin Integration

**Goal:** Hugo's commands are accessible as OpenCode custom tools so the agent can manage workflows conversationally.

### Task 6.1: Register management tools

In the plugin's `tool` hook, register:

- `hugo_install` — install a workflow from an npm package
- `hugo_update` — update installed workflows
- `hugo_list` — list installed workflows and their status
- `hugo_remove` — remove an installed workflow
- `hugo_status` — show integrity status of installed files

Each tool wraps the corresponding command implementation. The agent can manage workflows conversationally: "install the code-review workflow from @some-org/code-review-workflow."

### Task 6.2: Handle post-install reload

After installing or updating a workflow, OpenCode needs to discover new agents, skills, and commands. Since files are written to `.opencode/`, OpenCode's native discovery picks them up — but only after a reload.

Options:
- Call `client.instance.dispose()` after install to force OpenCode to re-discover (hot reload — heavy but works)
- Inform the user: "Workflow installed. Reload OpenCode to activate new agents and skills."
- Investigate whether OpenCode auto-detects new files in `.opencode/`

For v1, inform the user and let them decide when to reload. Don't force a dispose.

---

## Implementation Order

| Phase | Depends On | Complexity |
|-------|-----------|------------|
| Phase 1: Manifest Format | Nothing | Low — types and JSON parsing |
| Phase 2: Install Command | Phase 1 | Medium — bun integration, source resolution, file copy, state tracking |
| Phase 3: Local Edit Detection | Phase 2 | Low — hash comparison |
| Phase 4: Update Command | Phase 2, 3 | Medium — diff logic, skip/warn behavior |
| Phase 5: List and Remove | Phase 2, 3 | Low — state queries, file deletion |
| Phase 6: Plugin Integration | Phase 2-5 | Low — tool wrappers |

---

## Open Questions

1. **`.opencode/package.json` conflicts:** OpenCode already uses `.opencode/package.json` for plugin dependencies. Workflow packages would be added alongside them. Verify there are no conflicts — workflow packages aren't plugins, they're just npm packages that contain content files. They shouldn't interfere with plugin loading.

2. **Skill naming conflicts:** Two workflows might ship a skill with the same name (e.g., both have `git-diff/`). The conflict detection in Phase 2 catches this at install time and aborts. The user must remove the conflicting workflow first.

3. ~~**YAML dependency:**~~ **Resolved.** Everything uses JSON. No YAML dependency needed. Manifest is `hugo-workflow.json`, state is `state.json`.

4. **Post-install reload:** Is `client.instance.dispose()` the right mechanism, or is there a lighter-weight way to tell OpenCode "re-scan `.opencode/`"? This determines whether install is a one-step or two-step operation for the user.

5. ~~**Git repo fallback:**~~ **Resolved.** Git URLs are supported natively by bun. `bun add github:org/repo`, `bun add git+ssh://...`, etc. all work out of the box. No separate clone mechanism needed. The `PackageSource` type tracks whether a workflow came from a registry or git, and version resolution handles commit hashes for git sources.

6. **Scoped installs:** Should Hugo support installing a workflow globally (`~/.config/opencode/`) vs. project-locally (`.opencode/`)? For v1, project-local only.

# Hugo Refactors Plan

Tracked issues from the `/src` code review. Ordered by severity, then by locality (self-contained changes first, cross-cutting changes last).

---

## 1. Display `bunWarning` on remove [Bug]

**Files:** `src/cli.ts` (handleRemove)

**Problem:** `remove()` returns `{ bunWarning?: string }` when `bun remove` fails, but `handleRemove` in the CLI never logs it. The user gets no feedback that the npm package wasn't cleaned up from `.opencode/node_modules`.

**Fix:** After logging the "Removed" message, check `result.bunWarning` and log it:

```typescript
if (result.bunWarning) {
  console.log(`  Warning: ${result.bunWarning}`);
}
```

**Scope:** ~3 lines in one function.

---

## 2. Remove dead `KNOWN_FLAGS` constant [Dead Code]

**Files:** `src/cli.ts`

**Problem:** `KNOWN_FLAGS` (line 63) is defined but never referenced. The arg parser handles each flag individually and catches unknown flags via `arg.startsWith("-")`. The Set is misleading — it suggests it's used for validation when it isn't.

**Fix:** Delete the line:

```typescript
const KNOWN_FLAGS = new Set(["--force", "--all", "--help", "-h"]);
```

**Scope:** 1 line deletion.

---

## 3. Add `@opencode-ai/sdk` as a direct dependency [Fragile Dependency]

**Files:** `package.json`, `src/mcp/index.ts`, `src/mcp/grep_app.ts`, `src/mcp/websearch.ts`, `src/mcp/context7.ts`

**Problem:** All 4 MCP files import `McpRemoteConfig` from `@opencode-ai/sdk`, which is only available as a transitive dependency through `@opencode-ai/plugin`. This works today via bun's module hoisting but could break silently on any `@opencode-ai/plugin` version bump that changes or removes the sdk dependency.

**Fix:** Add `@opencode-ai/sdk` to `dependencies` in `package.json`. Pin to the same version currently resolved (check `node_modules/@opencode-ai/sdk/package.json` for the installed version). This is a type-only import so it could also go in `devDependencies`, but since the compiled output references the module at runtime for type resolution in the plugin system, `dependencies` is safer.

**Scope:** 1 line in `package.json`. No source changes.

---

## 4. Eliminate redundant `getWorkflow` lookup in health command [Optimization]

**Files:** `src/commands/health.ts`

**Problem:** The `targets` array stores `{ name, enabled }` but discards the `WorkflowEntry`. Then inside the loop (line 96), `getWorkflow(config, target.name)` re-looks up each entry that was already available from the earlier `getWorkflows()` / `getWorkflow()` calls.

**Fix:** Carry the entry through the `targets` array:

```typescript
// Change targets type from:
let targets: Array<{ name: string; enabled: boolean }>;

// To:
let targets: Array<{ name: string; enabled: boolean; entry: WorkflowEntry }>;
```

Then use `target.entry` directly in the loop instead of re-fetching. Remove the `if (!entry) continue` guard since the entry is guaranteed.

**Scope:** ~15 lines changed in one file. Import `WorkflowEntry` type.

---

## 5. Extract `errorMessage` utility [DRY / Consistency]

**Files:** `src/workflows/utils.ts` (new function), `src/workflows/bun.ts`, `src/workflows/manifest.ts`, `src/commands/install.ts`, `src/commands/update.ts`, `src/cli.ts`

**Problem:** The pattern `err instanceof Error ? err.message : String(err)` appears in 5+ files. It's a small thing, but it's the kind of repeated pattern that leads to inconsistency over time (e.g., one callsite might forget the `instanceof` check).

**Fix:** Add to `src/workflows/utils.ts`:

```typescript
/**
 * Extract a human-readable message from an unknown error value.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

Replace all inline occurrences across the codebase.

**Scope:** 1 new function, ~8 callsite replacements across 5 files.

---

## 6. Extract `.opencode` path helper [DRY / Consistency]

**Files:** `src/workflows/config.ts` (new function), `src/commands/install.ts`, `src/commands/remove.ts`, `src/commands/update.ts`

**Problem:** `join(projectDir, ".opencode")` is computed independently in install, remove, update, and collisions. The `.opencode` directory name is a convention that should be defined once.

**Fix:** Add to `src/workflows/config.ts` (where other config constants like `CONFIG_FILENAME` already live):

```typescript
export const OPENCODE_DIR = ".opencode";

export function getOpencodeDir(projectDir: string): string {
  return join(projectDir, OPENCODE_DIR);
}
```

Replace all `join(projectDir, ".opencode")` calls in commands. Also use `OPENCODE_DIR` in `collisions.ts` which currently hardcodes `".opencode"`.

**Scope:** 1 new export, ~5 callsite replacements across 4 files.

---

## 7. Document the types co-location rationale [Consistency / Clarity]

**Files:** `src/workflows/types.ts`

**Problem:** `workflows/` has a `types.ts` file but `commands/` and `mcp/` don't. This looks like an inconsistency but is actually correct: `workflows/types.ts` contains types shared across 6+ files (WorkflowEntry, CollisionWarning, etc.), while command types (InstallOptions, InstallResult, etc.) are each consumed by exactly one file.

The principle: **shared types get a shared home; single-consumer types stay co-located.** But without documentation, this reads as accidental rather than intentional.

**Fix:** Add a module-level doc comment to `src/workflows/types.ts`:

```typescript
/**
 * Shared type definitions for the workflows module.
 *
 * Types here are used across multiple files in workflows/ and commands/.
 * Command-specific types (e.g., InstallOptions, InstallResult) stay co-located
 * in their respective command files since they have a single consumer.
 */
```

**Scope:** 1 comment block.

---

## 8. Clean up `parsePackageSpec` GitHub shorthand [Minor Optimization]

**Files:** `src/workflows/bun.ts` (parsePackageSpec)

**Problem:** In the GitHub shorthand branch, `splitRef(spec)` is called to get `url` and `ref`, but then `spec.split("/")` is called twice more and `split("#")` is used again to derive `org` and `repo` for the warning message. The same information is already available from the parsed URL.

**Fix:** Derive `org` and `repo` from the already-parsed `url`:

```typescript
const { url, ref } = splitRef(spec);
const [org, repo] = url.split("/");
return {
  source: { type: "git", url: `github:${url}`, ref },
  warnings: [
    `Interpreting "${spec}" as a GitHub repo. If you meant the npm package @${org}/${repo}, use that instead.`,
  ],
};
```

**Scope:** ~3 lines changed in one function.

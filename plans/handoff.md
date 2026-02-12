# Handoff: Track MCP Servers in Workflow Manifests

Implemented the full plan from `plans/track-mcps.md`. Hugo now tracks which MCP servers each workflow provides — through build, install, update, list, and remove.

## What changed

`mcps: string[]` added to `WorkflowManifest`, `WorkflowEntry`, and every result type. `hugo build` detects MCPs by dynamically importing the plugin entry point, calling its `config` hook with a mock context, and reading `config.mcp` keys. Fallback: `hugo.mcps` in package.json. Graceful degradation with warning if plugin needs runtime APIs. 5s timeout. `hugo ls` displays MCPs. `hugo update` reports added/removed MCPs.

## Modified source files

- `src/workflows/types.ts` — `mcps` on `WorkflowManifest` + `WorkflowEntry`
- `src/workflows/manifest.ts` — parse `mcps` field
- `src/workflows/utils.ts` — shared `fileExists` utility
- `src/workflows/collisions.ts` — use shared `fileExists`, drop private `fileExistsSafe`
- `src/commands/build.ts` — MCP detection pipeline (`resolveSourceEntry`, `resolveExportsEntry`, `resolvePluginExport`, `isHooksObject`, `buildDeepProxy`, `detectMcps`, `detectMcpsWithTimeout`, `readPackageJsonMcps`), updated `BuildResult`, empty-content check
- `src/commands/install.ts` — `mcps` in `WorkflowEntry` + `InstallResult`
- `src/commands/update.ts` — `addedMcps`/`removedMcps` in `WorkflowUpdateDetail`, manifest comparison, state write
- `src/commands/list.ts` — `mcps` in `WorkflowListEntry`
- `src/commands/remove.ts` — `mcps` in `RemoveResult`
- `src/cli.ts` — `formatCount` 4th param, all 4 call sites, `handleList` MCPs display, `handleUpdate` MCP changes

## Modified tests

- `tests/unit/manifest.test.ts` — `mcps: []` in all `toEqual`, new "parses manifest with mcps" case
- `tests/unit/config.test.ts` — `mcps: []` on `sampleEntry`
- `tests/integration/build.test.ts` — error message + manifest keys updated, 8 new MCP detection tests
- `tests/integration/cli.test.ts` — error message updated

## New test fixtures

| Fixture | Purpose |
|---|---|
| `mcp-factory` | Default export factory registering MCPs via config hook |
| `mcp-hooks-object` | Default export as hooks object (non-function) |
| `mcp-declared` | `hugo.mcps` in package.json (manual declaration, skips plugin execution) |
| `mcp-runtime` | Plugin uses runtime APIs → graceful degradation with warning |
| `mcp-multi-export` | Multiple exports, `*Plugin` naming convention resolution |
| `mcp-exports-field` | `exports` field with `bun`/`import`/`default` conditions |
| `mcp-only` | Workflow providing only MCPs (no agents/commands/skills) |

## Test result

245 pass, 0 fail.

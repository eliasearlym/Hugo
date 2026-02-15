import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parse as parseJsonc,
  modify as modifyJsonc,
  applyEdits,
  type FormattingOptions,
} from "jsonc-parser";
import type { WorkflowEntry } from "./types";
import { isNodeError } from "./utils";

const CONFIG_FILENAME = "opencode.json";

const FORMATTING_OPTIONS: FormattingOptions = {
  tabSize: 2,
  insertSpaces: true,
  eol: "\n",
};

/**
 * Holds the raw JSONC text from the last readConfig call, keyed by projectDir.
 * Used by writeConfig to apply targeted edits that preserve comments.
 *
 * This is a module-level cache rather than a return-value change to avoid
 * altering the readConfig/writeConfig API that every command depends on.
 */
const rawConfigCache = new Map<string, string>();

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

/**
 * Read opencode.json from projectDir using jsonc-parser (supports comments).
 * Returns {} if the file doesn't exist.
 * Throws on permission errors or corrupt content that isn't valid JSONC.
 *
 * Caches the raw JSONC text so that writeConfig can apply targeted edits
 * that preserve user comments.
 */
export async function readConfig(
  projectDir: string,
): Promise<Record<string, unknown>> {
  const configPath = join(projectDir, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      rawConfigCache.delete(projectDir);
      return {};
    }
    throw err;
  }

  const errors: import("jsonc-parser").ParseError[] = [];
  const parsed = parseJsonc(raw, errors);

  if (errors.length > 0) {
    throw new Error(`Failed to parse ${CONFIG_FILENAME}: invalid JSONC`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${CONFIG_FILENAME} must contain a JSON object`);
  }

  rawConfigCache.set(projectDir, raw);
  return parsed as Record<string, unknown>;
}

/**
 * Write config to opencode.json. Creates the file if it doesn't exist.
 *
 * When a cached raw JSONC text exists (from a prior readConfig call), this
 * function applies targeted edits using jsonc-parser's modify/applyEdits API
 * to preserve user comments and formatting. Only the `plugin` and `hugo` keys
 * (the regions Hugo manages) are updated.
 *
 * Falls back to full JSON.stringify when no cached text exists (e.g. the file
 * was created by Hugo from scratch).
 *
 * **Known limitation — no concurrent-access protection.**
 * All mutating commands follow a readConfig() → modify → writeConfig() pattern.
 * If another process (another Hugo instance, OpenCode, or a manual edit) modifies
 * opencode.json between our read and write, those changes are silently overwritten.
 *
 * Why this is acceptable today:
 * - Hugo is a user-driven CLI — concurrent invocations don't happen in practice.
 * - opencode.json is small (<4KB), so writeFile is effectively atomic (single
 *   write syscall). Readers won't see partial content.
 * - The longest race window is `hugo install` for registry sources, where
 *   readConfig happens before `bun add` and writeConfig happens after manifest
 *   parsing + collision detection + skill syncing.
 *
 * If Hugo gains a daemon mode, a watch loop, or programmatic composition of
 * commands, revisit with advisory file locking or mtime-based compare-and-swap.
 */
export async function writeConfig(
  projectDir: string,
  config: Record<string, unknown>,
): Promise<void> {
  const configPath = join(projectDir, CONFIG_FILENAME);
  const cachedRaw = rawConfigCache.get(projectDir);

  let output: string;

  if (cachedRaw !== undefined) {
    // Apply targeted edits to preserve comments and formatting.
    // Compare the new config against the cached parse to find what changed,
    // then apply only those changes to the raw JSONC text.
    let text = cachedRaw;
    const oldConfig = parseJsonc(cachedRaw) as Record<string, unknown> ?? {};

    // Collect all top-level keys from both old and new configs.
    const allKeys = new Set([
      ...Object.keys(oldConfig),
      ...Object.keys(config),
    ]);

    for (const key of allKeys) {
      const oldVal = oldConfig[key];
      const newVal = config[key];

      // Key was removed from config.
      if (!(key in config)) {
        const edits = modifyJsonc(text, [key], undefined, {
          formattingOptions: FORMATTING_OPTIONS,
        });
        text = applyEdits(text, edits);
        continue;
      }

      // Key is new or value changed — apply the edit.
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        const edits = modifyJsonc(text, [key], newVal, {
          formattingOptions: FORMATTING_OPTIONS,
        });
        text = applyEdits(text, edits);
      }
    }

    output = text;
  } else {
    output = JSON.stringify(config, null, 2) + "\n";
  }

  // Update the cache so that consecutive writes within the same process
  // (e.g. update command writing multiple workflows) stay consistent.
  rawConfigCache.set(projectDir, output);

  await writeFile(configPath, output, "utf-8");
}

// ---------------------------------------------------------------------------
// Plugin array management
// ---------------------------------------------------------------------------

/**
 * Get the plugin array from config. Returns [] if missing.
 */
export function getPlugins(config: Record<string, unknown>): string[] {
  const plugins = config.plugin;
  if (!Array.isArray(plugins)) return [];
  return plugins.filter((p): p is string => typeof p === "string");
}

/**
 * Check if a package name is in the plugin array.
 */
export function hasPlugin(
  config: Record<string, unknown>,
  packageName: string,
): boolean {
  return getPlugins(config).includes(packageName);
}

/**
 * Add a package name to the plugin array. No-op if already present.
 * Returns the mutated config.
 */
export function addPlugin(
  config: Record<string, unknown>,
  packageName: string,
): Record<string, unknown> {
  const plugins = getPlugins(config);
  if (!plugins.includes(packageName)) {
    plugins.push(packageName);
  }
  config.plugin = plugins;
  return config;
}

/**
 * Remove a package name from the plugin array. No-op if absent.
 * Returns the mutated config.
 */
export function removePlugin(
  config: Record<string, unknown>,
  packageName: string,
): Record<string, unknown> {
  const plugins = getPlugins(config);
  const filtered = plugins.filter((p) => p !== packageName);
  config.plugin = filtered;
  return config;
}

// ---------------------------------------------------------------------------
// Hugo state (config.hugo.workflows)
// ---------------------------------------------------------------------------

/**
 * Get all workflow entries. Returns {} if hugo.workflows doesn't exist.
 * Use setWorkflow/removeWorkflow for mutations — the returned object may
 * be a detached empty object.
 */
export function getWorkflows(
  config: Record<string, unknown>,
): Readonly<Record<string, WorkflowEntry>> {
  const hugo = config.hugo;
  if (!hugo || typeof hugo !== "object" || Array.isArray(hugo)) return {};

  const workflows = (hugo as Record<string, unknown>).workflows;
  if (!workflows || typeof workflows !== "object" || Array.isArray(workflows)) {
    return {};
  }

  return workflows as Record<string, WorkflowEntry>;
}

/**
 * Get a single workflow entry by name. Returns undefined if not found.
 */
export function getWorkflow(
  config: Record<string, unknown>,
  name: string,
): WorkflowEntry | undefined {
  return getWorkflows(config)[name];
}

/**
 * Set a workflow entry. Creates hugo.workflows if it doesn't exist.
 * Returns the mutated config.
 */
export function setWorkflow(
  config: Record<string, unknown>,
  name: string,
  entry: WorkflowEntry,
): Record<string, unknown> {
  const hugo = ensureHugoKey(config);
  const workflows = ensureWorkflowsKey(hugo);
  workflows[name] = entry;
  return config;
}

/**
 * Remove a workflow entry. No-op if absent.
 * Returns the mutated config.
 */
export function removeWorkflow(
  config: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const hugo = config.hugo;
  if (!hugo || typeof hugo !== "object" || Array.isArray(hugo)) return config;

  const workflows = (hugo as Record<string, unknown>).workflows;
  if (!workflows || typeof workflows !== "object" || Array.isArray(workflows)) {
    return config;
  }

  delete (workflows as Record<string, unknown>)[name];
  return config;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureHugoKey(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (!config.hugo || typeof config.hugo !== "object" || Array.isArray(config.hugo)) {
    config.hugo = {};
  }
  return config.hugo as Record<string, unknown>;
}

function ensureWorkflowsKey(
  hugo: Record<string, unknown>,
): Record<string, WorkflowEntry> {
  if (
    !hugo.workflows ||
    typeof hugo.workflows !== "object" ||
    Array.isArray(hugo.workflows)
  ) {
    hugo.workflows = {};
  }
  return hugo.workflows as Record<string, WorkflowEntry>;
}

// ---------------------------------------------------------------------------
// Workflow target resolution
// ---------------------------------------------------------------------------

/**
 * Resolve workflow targets by name or all installed.
 * Shared by enable, disable, and other commands that operate on named workflows.
 *
 * - If `all` is true, returns all installed workflows (errors if none installed).
 * - Otherwise, looks up each name and errors if any are not found.
 * - Errors if `names` is empty and `all` is false.
 */
export function resolveWorkflowTargets(
  config: Record<string, unknown>,
  names: string[],
  all: boolean,
): Array<{ name: string; entry: WorkflowEntry }> {
  if (all) {
    const workflows = getWorkflows(config);
    const entries = Object.entries(workflows);
    if (entries.length === 0) {
      throw new Error("No workflows installed.");
    }
    return entries.map(([name, entry]) => ({ name, entry }));
  }

  if (names.length === 0) {
    throw new Error("No workflow names specified.");
  }

  return names.map((name) => {
    const entry = getWorkflow(config, name);
    if (!entry) {
      throw new Error(`Workflow "${name}" is not installed.`);
    }
    return { name, entry };
  });
}

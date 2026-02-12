import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import type { WorkflowEntry } from "./types";
import { isNodeError } from "./utils";

const CONFIG_FILENAME = "opencode.json";

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

/**
 * Read opencode.json from projectDir using jsonc-parser (supports comments).
 * Returns {} if the file doesn't exist.
 * Throws on permission errors or corrupt content that isn't valid JSONC.
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

  return parsed as Record<string, unknown>;
}

/**
 * Write config to opencode.json. Creates the file if it doesn't exist.
 * Writes standard JSON (comments are stripped — known limitation).
 *
 * **Known limitation — no concurrent-access protection.**
 * All mutating commands follow a readConfig() → modify → writeConfig() pattern.
 * If another process (another Hugo instance, OpenCode, or a manual edit) modifies
 * opencode.json between our read and write, those changes are silently overwritten.
 * A full fix would require file locking (e.g. advisory locks via flock) or an
 * atomic read-modify-write with mtime-based compare-and-swap.
 */
export async function writeConfig(
  projectDir: string,
  config: Record<string, unknown>,
): Promise<void> {
  const configPath = join(projectDir, CONFIG_FILENAME);
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
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



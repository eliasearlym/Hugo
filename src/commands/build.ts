import { join } from "node:path";
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import type { WorkflowManifest } from "../workflows/types";
import { errorMessage, fileExists } from "../workflows/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BuildOptions = {
  projectDir: string;
};

export type BuildResult = {
  agents: string[];
  commands: string[];
  skills: string[];
  mcps: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Build command
// ---------------------------------------------------------------------------

/**
 * Generate workflow.json from conventional directory structure.
 * Scans agents, commands (.md files), and skills (directories with SKILL.md).
 * Detects MCP server registrations from the plugin entry point or package.json.
 * Does NOT read .md contents, validate frontmatter, or generate code.
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
  const { projectDir } = options;
  const warnings: string[] = [];

  let packageJson: Record<string, unknown>;
  let rawPackageJson: string;
  try {
    rawPackageJson = await readFile(join(projectDir, "package.json"), "utf-8");
  } catch {
    throw new Error(
      "No package.json found. Run hugo build from a workflow package directory.",
    );
  }
  try {
    packageJson = JSON.parse(rawPackageJson) as Record<string, unknown>;
  } catch {
    throw new Error("package.json contains invalid JSON.");
  }

  if (!packageJson.name || typeof packageJson.name !== "string") {
    warnings.push('package.json missing "name" field.');
  }
  if (
    !packageJson.description ||
    typeof packageJson.description !== "string"
  ) {
    warnings.push('package.json missing "description" field.');
  }

  const agents = await scanMdFiles(join(projectDir, "agents"));
  const commands = await scanMdFiles(join(projectDir, "commands"));
  const skills = await scanSkillDirs(join(projectDir, "skills"), warnings);

  // Resolve MCPs: package.json declaration first, then plugin execution
  let mcps: string[];
  const declaredMcps = readPackageJsonMcps(packageJson, warnings);
  if (declaredMcps) {
    mcps = declaredMcps;
  } else {
    try {
      mcps = await detectMcpsWithTimeout(projectDir, packageJson);
    } catch (err) {
      warnings.push(
        `Could not auto-detect MCP servers: ${errorMessage(err)}. ` +
        `Declare them in package.json under "hugo.mcps".`,
      );
      mcps = [];
    }
  }

  if (agents.length === 0 && commands.length === 0 && skills.length === 0 && mcps.length === 0) {
    throw new Error("No agents, commands, skills, or MCP servers found. Nothing to build.");
  }

  checkDuplicates(agents, "agents");
  checkDuplicates(commands, "commands");
  checkDuplicates(skills, "skills");
  // Only meaningful for the hugo.mcps package.json path — Object.keys() from
  // plugin detection is inherently unique.
  checkDuplicates(mcps, "mcps");

  const manifest: WorkflowManifest = { agents, commands, skills, mcps };
  await writeFile(
    join(projectDir, "workflow.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );

  return { agents, commands, skills, mcps, warnings };
}

// ---------------------------------------------------------------------------
// MCP detection
// ---------------------------------------------------------------------------

const DETECT_TIMEOUT_MS = 5_000;

/**
 * Read manually declared MCP names from package.json "hugo.mcps".
 * Returns null if not declared (so caller can fall through to plugin execution).
 */
function readPackageJsonMcps(
  packageJson: Record<string, unknown>,
  warnings: string[],
): string[] | null {
  const hugo = packageJson.hugo;
  if (!hugo || typeof hugo !== "object" || Array.isArray(hugo)) return null;

  const hugoObj = hugo as Record<string, unknown>;
  const mcps = hugoObj.mcps;
  if (!mcps) return null;

  if (!Array.isArray(mcps)) return null;

  const result: string[] = [];
  for (let i = 0; i < mcps.length; i++) {
    const item = mcps[i];
    if (typeof item === "string") {
      result.push(item);
    } else {
      warnings.push(
        `hugo.mcps[${i}] in package.json is not a string (got ${typeof item}) — skipped.`,
      );
    }
  }
  return result.sort();
}

/**
 * Wrap detectMcps in a timeout to prevent hung plugins from blocking build.
 */
async function detectMcpsWithTimeout(
  projectDir: string,
  pkg: Record<string, unknown>,
): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("MCP detection timed out")),
      DETECT_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([detectMcps(projectDir, pkg), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/**
 * Execute the plugin function with a mock context and inspect what
 * the config hook writes to config.mcp.
 */
async function detectMcps(
  projectDir: string,
  pkg: Record<string, unknown>,
): Promise<string[]> {
  // 1. Resolve source entry point
  const entryPath = await resolveSourceEntry(projectDir, pkg);
  if (!entryPath) return [];

  // 2. Dynamic import (bun handles TypeScript natively)
  //    Cache-bust to prevent stale modules when build is run multiple times
  //    in the same process (e.g. in tests).
  const mod = await import(entryPath + "?t=" + Date.now());

  // 3. Find the exported Plugin
  const pluginExport = resolvePluginExport(mod);
  if (!pluginExport) return [];

  // 4. Get the hooks object — either by calling the factory or using directly
  let hooks: Record<string, unknown>;

  if (pluginExport.kind === "factory") {
    hooks = await pluginExport.fn({
      client: buildDeepProxy("SDK not available during build"),
      project: buildDeepProxy("Project context not available during build"),
      directory: projectDir,
      worktree: projectDir,
      serverUrl: new URL("http://localhost:0"),
      $: buildDeepProxy("Shell not available during build"),
    });
  } else {
    hooks = pluginExport.hooks;
  }

  // 5. Call the config hook with an empty object and read what it wrote
  if (!hooks?.config) return [];
  if (typeof hooks.config !== "function") return [];

  const mockConfig: Record<string, unknown> = {};
  await hooks.config(mockConfig);

  if (mockConfig.mcp && typeof mockConfig.mcp === "object" && !Array.isArray(mockConfig.mcp)) {
    return Object.keys(mockConfig.mcp as Record<string, unknown>).sort();
  }

  return [];
}

// ---------------------------------------------------------------------------
// Source entry point resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the source entry point for a workflow package.
 * pkg.main/pkg.module typically point to compiled output that doesn't exist
 * at build time. Probe for actual source files instead.
 */
async function resolveSourceEntry(
  projectDir: string,
  pkg: Record<string, unknown>,
): Promise<string | null> {
  // Explicit source field takes priority
  if (typeof pkg.source === "string") {
    const p = join(projectDir, pkg.source);
    if (await fileExists(p)) return p;
  }

  // package.json "exports" field — the modern standard for entry points
  const exportsEntry = resolveExportsEntry(pkg);
  if (exportsEntry) {
    const p = join(projectDir, exportsEntry);
    if (await fileExists(p)) return p;
  }

  // Common source entry points
  for (const candidate of ["index.ts", "src/index.ts"]) {
    const p = join(projectDir, candidate);
    if (await fileExists(p)) return p;
  }

  // Fall back to main/module — may work if the author uses .ts directly
  for (const field of ["main", "module"]) {
    if (typeof pkg[field] === "string") {
      const p = join(projectDir, pkg[field] as string);
      if (await fileExists(p)) return p;
    }
  }

  return null;
}

/**
 * Extract the "." entry point from the package.json "exports" field.
 * Supports:
 *   - String shorthand: "exports": "./src/index.ts"
 *   - Condition object:  "exports": { ".": { "bun": "./src/index.ts" } }
 *   - Nested ".":        "exports": { ".": "./src/index.ts" }
 * Prefers the "bun" condition, then "import", then "default".
 */
function resolveExportsEntry(pkg: Record<string, unknown>): string | null {
  const exports = pkg.exports;
  if (!exports) return null;

  // String shorthand: "exports": "./src/index.ts"
  if (typeof exports === "string") return exports;

  if (typeof exports !== "object" || Array.isArray(exports)) return null;
  const exportsObj = exports as Record<string, unknown>;

  // "exports": { ".": ... }
  const dot = exportsObj["."];
  if (!dot) return null;

  // "exports": { ".": "./src/index.ts" }
  if (typeof dot === "string") return dot;

  if (typeof dot !== "object" || Array.isArray(dot)) return null;
  const conditions = dot as Record<string, unknown>;

  // Prefer bun > import > default
  for (const key of ["bun", "import", "default"]) {
    if (typeof conditions[key] === "string") return conditions[key] as string;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Plugin export resolution
// ---------------------------------------------------------------------------

type PluginExport =
  | { kind: "factory"; fn: Function }
  | { kind: "hooks"; hooks: Record<string, unknown> };

/**
 * Resolve the plugin export from a module.
 *
 * Resolution order for factories:
 *   a. Default export, if it's a function
 *   b. If exactly one exported function exists, use it
 *   c. If multiple, pick the first whose name ends with "Plugin" (case-insensitive)
 * Fallback for hooks objects:
 *   d. Default export, if it has a `config` function property
 *   e. If exactly one export has a `config` function, use it
 *   f. Otherwise give up — can't disambiguate
 */
function resolvePluginExport(mod: Record<string, unknown>): PluginExport | null {
  // --- Factory function resolution ---

  // Default export is the strongest signal
  if (typeof mod.default === "function") {
    return { kind: "factory", fn: mod.default as Function };
  }

  const exportedFns = Object.entries(mod)
    .filter(([, v]) => typeof v === "function") as [string, Function][];

  // Single function export — unambiguous
  if (exportedFns.length === 1) {
    return { kind: "factory", fn: exportedFns[0][1] };
  }

  // Multiple function exports — pick the one named *Plugin
  if (exportedFns.length > 1) {
    const pluginExport = exportedFns.find(([name]) =>
      name.toLowerCase().endsWith("plugin"),
    );
    if (pluginExport) return { kind: "factory", fn: pluginExport[1] };
  }

  // --- Hooks object resolution (non-function exports) ---

  // Default export could be a pre-built hooks object
  if (isHooksObject(mod.default)) {
    return { kind: "hooks", hooks: mod.default };
  }

  // Named export that looks like a hooks object
  const hookExports = Object.values(mod).filter(isHooksObject);
  if (hookExports.length === 1) {
    return { kind: "hooks", hooks: hookExports[0] };
  }

  // Can't disambiguate
  return null;
}

/**
 * Type guard: checks if a value is a plain object with a `config` function property.
 */
function isHooksObject(
  value: unknown,
): value is Record<string, unknown> & { config: Function } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).config === "function"
  );
}

// ---------------------------------------------------------------------------
// Deep proxy for mock context
// ---------------------------------------------------------------------------

/**
 * Build a recursive proxy that returns another proxy for every property access
 * and throws with a clear message when something is called. Handles arbitrarily
 * deep property chains like ctx.client.api.listTools() without crashing on
 * intermediate access.
 */
function buildDeepProxy(errorMsg: string): unknown {
  const handler: ProxyHandler<Function> = {
    get: (_target, prop) => {
      // Allow type coercion to work
      if (prop === Symbol.toPrimitive || prop === "toString" || prop === "valueOf") {
        return () => errorMsg;
      }
      return buildDeepProxy(errorMsg);
    },
    apply: () => {
      throw new Error(errorMsg);
    },
  };
  return new Proxy(function () {}, handler);
}

// ---------------------------------------------------------------------------
// Directory scanning helpers
// ---------------------------------------------------------------------------

/**
 * Scan a directory for .md files and return names (filename minus .md).
 * Returns [] if the directory doesn't exist.
 */
async function scanMdFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (entry.endsWith(".md")) {
      names.push(entry.slice(0, -3));
    }
  }

  return names.sort();
}

/**
 * Scan a directory for skill subdirectories containing SKILL.md.
 * Returns skill names (directory name). Warns for directories missing SKILL.md.
 * Returns [] if the directory doesn't exist.
 * Runs stat calls in parallel for better I/O performance.
 */
async function scanSkillDirs(
  dir: string,
  warnings: string[],
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const entryChecks = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dir, entry);
      try {
        const entryStat = await stat(entryPath);
        return { entry, isDir: entryStat.isDirectory() };
      } catch {
        return { entry, isDir: false };
      }
    }),
  );

  const dirs = entryChecks.filter((e) => e.isDir);

  const skillChecks = await Promise.all(
    dirs.map(async ({ entry }) => {
      const skillMdPath = join(dir, entry, "SKILL.md");
      try {
        await stat(skillMdPath);
        return { entry, hasSkillMd: true };
      } catch {
        return { entry, hasSkillMd: false };
      }
    }),
  );

  const names: string[] = [];
  for (const { entry, hasSkillMd } of skillChecks) {
    if (hasSkillMd) {
      names.push(entry);
    } else {
      warnings.push(`skills/${entry}/ is missing SKILL.md — skipped.`);
    }
  }

  return names.sort();
}

/**
 * Check for duplicate names within a category. Throws on duplicates.
 *
 * For agents and commands (sourced from filenames), the filesystem prevents
 * duplicates — a directory can't contain two files with the same name. This
 * check is a safety net for skills (where the name comes from directory names)
 * and guards against future changes to the scanning logic.
 */
function checkDuplicates(names: string[], category: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(
        `Duplicate ${category.slice(0, -1)} name: "${name}".`,
      );
    }
    seen.add(name);
  }
}

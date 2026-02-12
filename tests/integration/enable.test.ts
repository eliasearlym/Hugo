import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTempDir, fixtureDir, readConfig } from "../helpers";
import { install } from "../../src/commands/install";
import { enable } from "../../src/commands/enable";
import {
  readConfig as readCfg,
  writeConfig,
  removePlugin,
  hasPlugin,
} from "../../src/workflows/config";

let projectDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: projectDir, cleanup } = await createTempDir());
});

afterEach(async () => {
  await cleanup();
});

/**
 * Helper: install a workflow then disable it by removing from plugin array.
 */
async function installAndDisable(fixtureName: string): Promise<void> {
  await install({ projectDir, spec: `file:${fixtureDir(fixtureName)}` });
  const config = await readCfg(projectDir);
  // The package name equals the fixture name for our local fixtures
  removePlugin(config, fixtureName);
  await writeConfig(projectDir, config);
}

describe("enable", () => {
  // -----------------------------------------------------------------------
  // Basic enable
  // -----------------------------------------------------------------------

  test("enables a disabled workflow", async () => {
    await installAndDisable("basic-workflow");

    const result = await enable({ projectDir, names: ["basic-workflow"] });

    expect(result.workflows.length).toBe(1);
    expect(result.workflows[0].workflowName).toBe("basic-workflow");
    expect(result.workflows[0].alreadyEnabled).toBe(false);

    // Verify config
    const config = await readCfg(projectDir);
    expect(hasPlugin(config, "basic-workflow")).toBe(true);
  });

  test("enables multiple workflows at once", async () => {
    await installAndDisable("basic-workflow");
    await installAndDisable("agents-only");

    const result = await enable({
      projectDir,
      names: ["basic-workflow", "agents-only"],
    });

    expect(result.workflows.length).toBe(2);
    expect(result.workflows.every((w) => !w.alreadyEnabled)).toBe(true);

    const config = await readCfg(projectDir);
    expect(hasPlugin(config, "basic-workflow")).toBe(true);
    expect(hasPlugin(config, "agents-only")).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Already enabled
  // -----------------------------------------------------------------------

  test("skips already-enabled workflow with note", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    const result = await enable({ projectDir, names: ["basic-workflow"] });

    expect(result.workflows.length).toBe(1);
    expect(result.workflows[0].alreadyEnabled).toBe(true);
  });

  test("mixed: enables disabled and skips enabled", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await installAndDisable("agents-only");

    const result = await enable({
      projectDir,
      names: ["basic-workflow", "agents-only"],
    });

    const bw = result.workflows.find((w) => w.workflowName === "basic-workflow");
    const ao = result.workflows.find((w) => w.workflowName === "agents-only");
    expect(bw?.alreadyEnabled).toBe(true);
    expect(ao?.alreadyEnabled).toBe(false);
  });

  // -----------------------------------------------------------------------
  // --all flag
  // -----------------------------------------------------------------------

  test("--all enables all disabled workflows", async () => {
    await installAndDisable("basic-workflow");
    await installAndDisable("agents-only");

    const result = await enable({ projectDir, names: [], all: true });

    expect(result.workflows.length).toBe(2);
    expect(result.workflows.every((w) => !w.alreadyEnabled)).toBe(true);

    const config = await readCfg(projectDir);
    expect(hasPlugin(config, "basic-workflow")).toBe(true);
    expect(hasPlugin(config, "agents-only")).toBe(true);
  });

  test("--all when all already enabled reports all as already enabled", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });

    const result = await enable({ projectDir, names: [], all: true });

    expect(result.workflows.every((w) => w.alreadyEnabled)).toBe(true);
  });

  test("--all errors when no workflows installed", async () => {
    await expect(
      enable({ projectDir, names: [], all: true }),
    ).rejects.toThrow("No workflows installed.");
  });

  // -----------------------------------------------------------------------
  // Errors
  // -----------------------------------------------------------------------

  test("errors when workflow not found", async () => {
    await expect(
      enable({ projectDir, names: ["nonexistent"] }),
    ).rejects.toThrow('Workflow "nonexistent" is not installed.');
  });

  test("errors when no names and no --all", async () => {
    await expect(enable({ projectDir, names: [] })).rejects.toThrow(
      "No workflow names specified.",
    );
  });

  // -----------------------------------------------------------------------
  // Collision detection
  // -----------------------------------------------------------------------

  test("detects cross-workflow collision on enable", async () => {
    // Install basic-workflow (has agent "reviewer") — stays enabled
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    // Install conflict-workflow (also has agent "reviewer") — disable it
    await installAndDisable("conflict-workflow");

    // Now enable it — should warn about cross-workflow collision
    const result = await enable({
      projectDir,
      names: ["conflict-workflow"],
    });

    const crossWarnings = result.workflows[0].warnings.filter(
      (w) => w.type === "cross-workflow",
    );
    expect(crossWarnings.length).toBe(1);
    expect(crossWarnings[0].name).toBe("reviewer");
    expect(crossWarnings[0].entity).toBe("agent");
  });

  test("detects .opencode/ file collision on enable", async () => {
    await installAndDisable("basic-workflow");

    // Create a user agent file that shadows the workflow's agent
    const agentsDir = join(projectDir, ".opencode", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "reviewer.md"), "# My custom reviewer");

    const result = await enable({
      projectDir,
      names: ["basic-workflow"],
    });

    const fileWarnings = result.workflows[0].warnings.filter(
      (w) => w.type === "overridden-by-file",
    );
    expect(fileWarnings.length).toBe(1);
    expect(fileWarnings[0].name).toBe("reviewer");
  });

  // -----------------------------------------------------------------------
  // Config preservation
  // -----------------------------------------------------------------------

  test("preserves other config keys", async () => {
    // Set up config with user settings
    await writeFile(
      join(projectDir, "opencode.json"),
      JSON.stringify({ theme: "dark", mcp: { server: {} } }),
    );

    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    // Disable then re-enable
    const config1 = await readCfg(projectDir);
    removePlugin(config1, "basic-workflow");
    await writeConfig(projectDir, config1);

    await enable({ projectDir, names: ["basic-workflow"] });

    const config2 = await readCfg(projectDir);
    expect(config2.theme).toBe("dark");
    expect(config2.mcp).toEqual({ server: {} });
  });

  test("does not write config if nothing changed", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    // Read file modification time before enable (no-op)
    const { stat } = await import("node:fs/promises");
    const configPath = join(projectDir, "opencode.json");
    const mtimeBefore = (await stat(configPath)).mtimeMs;

    // Small delay to ensure mtime would change if file is written
    await new Promise((r) => setTimeout(r, 50));

    await enable({ projectDir, names: ["basic-workflow"] });

    const mtimeAfter = (await stat(configPath)).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });
});

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTempDir, fixtureDir, fileExists } from "../helpers";
import { install } from "../../src/commands/install";
import { disable } from "../../src/commands/disable";
import {
  readConfig,
  writeConfig,
  removePlugin,
  hasPlugin,
  getWorkflow,
} from "../../src/workflows/config";

let projectDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: projectDir, cleanup } = await createTempDir());
});

afterEach(async () => {
  await cleanup();
});

describe("disable", () => {
  // -----------------------------------------------------------------------
  // Basic disable
  // -----------------------------------------------------------------------

  test("disables an enabled workflow", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    const result = await disable({ projectDir, names: ["basic-workflow"] });

    expect(result.workflows.length).toBe(1);
    expect(result.workflows[0].workflowName).toBe("basic-workflow");
    expect(result.workflows[0].alreadyDisabled).toBe(false);

    // Verify removed from plugin array
    const config = await readConfig(projectDir);
    expect(hasPlugin(config, "basic-workflow")).toBe(false);

    // Verify still tracked in hugo state
    expect(getWorkflow(config, "basic-workflow")).toBeDefined();
  });

  test("disables multiple workflows at once", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });

    const result = await disable({
      projectDir,
      names: ["basic-workflow", "agents-only"],
    });

    expect(result.workflows.length).toBe(2);
    expect(result.workflows.every((w) => !w.alreadyDisabled)).toBe(true);

    const config = await readConfig(projectDir);
    expect(hasPlugin(config, "basic-workflow")).toBe(false);
    expect(hasPlugin(config, "agents-only")).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Already disabled
  // -----------------------------------------------------------------------

  test("skips already-disabled workflow with note", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    // Disable once
    await disable({ projectDir, names: ["basic-workflow"] });

    // Disable again — should report already disabled
    const result = await disable({ projectDir, names: ["basic-workflow"] });

    expect(result.workflows[0].alreadyDisabled).toBe(true);
  });

  test("mixed: disables enabled and skips disabled", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });

    // Disable basic-workflow first
    await disable({ projectDir, names: ["basic-workflow"] });

    // Now disable both — basic should be already disabled, agents-only should disable
    const result = await disable({
      projectDir,
      names: ["basic-workflow", "agents-only"],
    });

    const bw = result.workflows.find(
      (w) => w.workflowName === "basic-workflow",
    );
    const ao = result.workflows.find((w) => w.workflowName === "agents-only");
    expect(bw?.alreadyDisabled).toBe(true);
    expect(ao?.alreadyDisabled).toBe(false);
  });

  // -----------------------------------------------------------------------
  // --all flag
  // -----------------------------------------------------------------------

  test("--all disables all enabled workflows", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });

    const result = await disable({ projectDir, names: [], all: true });

    expect(result.workflows.length).toBe(2);
    expect(result.workflows.every((w) => !w.alreadyDisabled)).toBe(true);

    const config = await readConfig(projectDir);
    expect(hasPlugin(config, "basic-workflow")).toBe(false);
    expect(hasPlugin(config, "agents-only")).toBe(false);
  });

  test("--all when all already disabled reports all as already disabled", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await disable({ projectDir, names: ["basic-workflow"] });

    const result = await disable({ projectDir, names: [], all: true });

    expect(result.workflows.every((w) => w.alreadyDisabled)).toBe(true);
  });

  test("--all errors when no workflows installed", async () => {
    await expect(
      disable({ projectDir, names: [], all: true }),
    ).rejects.toThrow("No workflows installed.");
  });

  // -----------------------------------------------------------------------
  // Errors
  // -----------------------------------------------------------------------

  test("errors when workflow not found", async () => {
    await expect(
      disable({ projectDir, names: ["nonexistent"] }),
    ).rejects.toThrow('Workflow "nonexistent" is not installed.');
  });

  test("errors when no names and no --all", async () => {
    await expect(disable({ projectDir, names: [] })).rejects.toThrow(
      "No workflow names specified.",
    );
  });

  // -----------------------------------------------------------------------
  // Skill syncing
  // -----------------------------------------------------------------------

  test("removes synced skill directories on disable", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    const skillDir = join(projectDir, ".opencode", "skills", "analysis");
    expect(await fileExists(skillDir)).toBe(true);

    const result = await disable({ projectDir, names: ["basic-workflow"] });

    expect(await fileExists(skillDir)).toBe(false);
    expect(result.workflows[0].syncWarnings).toEqual([]);
  });

  test("clears sync state from entry on disable", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    // Before disable, sync state exists
    let config = await readConfig(projectDir);
    let entry = getWorkflow(config, "basic-workflow");
    expect(entry?.sync).toBeDefined();

    await disable({ projectDir, names: ["basic-workflow"] });

    // After disable, sync state should be cleared
    config = await readConfig(projectDir);
    entry = getWorkflow(config, "basic-workflow");
    expect(entry?.sync).toBeUndefined();
  });

  test("does not remove skipped skill directories on disable", async () => {
    // Pre-create a user skill directory before install
    const { mkdir, writeFile } = await import("node:fs/promises");
    const skillDir = join(projectDir, ".opencode", "skills", "analysis");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# User's version");

    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    // Sync state should show "skipped"
    let config = await readConfig(projectDir);
    let entry = getWorkflow(config, "basic-workflow");
    expect(entry?.sync?.skills?.analysis?.status).toBe("skipped");

    await disable({ projectDir, names: ["basic-workflow"] });

    // User's directory should still exist
    expect(await fileExists(skillDir)).toBe(true);
  });

  test("handles disable of workflow with no skills", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });

    const result = await disable({ projectDir, names: ["agents-only"] });

    expect(result.workflows[0].syncWarnings).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // State preservation
  // -----------------------------------------------------------------------

  test("disabled workflow stays tracked in hugo state", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await disable({ projectDir, names: ["basic-workflow"] });

    const config = await readConfig(projectDir);
    const entry = getWorkflow(config, "basic-workflow");
    expect(entry).toBeDefined();
    expect(entry?.package).toBe("basic-workflow");
    expect(entry?.version).toBe("1.0.0");
    expect(entry?.agents).toEqual(["reviewer"]);
  });

  test("does not write config if nothing changed", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await disable({ projectDir, names: ["basic-workflow"] });

    const { stat } = await import("node:fs/promises");
    const configPath = join(projectDir, "opencode.json");
    const mtimeBefore = (await stat(configPath)).mtimeMs;

    await new Promise((r) => setTimeout(r, 50));

    // Already disabled — should be a no-op
    await disable({ projectDir, names: ["basic-workflow"] });

    const mtimeAfter = (await stat(configPath)).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });
});

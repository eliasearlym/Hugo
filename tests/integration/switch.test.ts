import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTempDir, fixtureDir, fileExists } from "../helpers";
import { install } from "../../src/commands/install";
import { switchWorkflows } from "../../src/commands/switch";
import { readConfig, hasPlugin } from "../../src/workflows/config";

let projectDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: projectDir, cleanup } = await createTempDir());
});

afterEach(async () => {
  await cleanup();
});

describe("switch", () => {
  // -----------------------------------------------------------------------
  // Basic switch
  // -----------------------------------------------------------------------

  test("switches to a single workflow, disabling others", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });

    const result = await switchWorkflows({
      projectDir,
      names: ["basic-workflow"],
    });

    expect(result.alreadyActive).toBe(false);
    expect(result.enabled.length).toBe(1);
    expect(result.enabled[0].workflowName).toBe("basic-workflow");
    expect(result.disabled.length).toBe(1);
    expect(result.disabled[0].workflowName).toBe("agents-only");

    const config = await readConfig(projectDir);
    expect(hasPlugin(config, "basic-workflow")).toBe(true);
    expect(hasPlugin(config, "agents-only")).toBe(false);
  });

  test("switches to multiple workflows, disabling the rest", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });
    await install({
      projectDir,
      spec: `file:${fixtureDir("conflict-workflow")}`,
    });

    const result = await switchWorkflows({
      projectDir,
      names: ["basic-workflow", "agents-only"],
    });

    expect(result.alreadyActive).toBe(false);
    expect(result.enabled.length).toBe(2);
    expect(result.disabled.length).toBe(1);
    expect(result.disabled[0].workflowName).toBe("conflict-workflow");

    const config = await readConfig(projectDir);
    expect(hasPlugin(config, "basic-workflow")).toBe(true);
    expect(hasPlugin(config, "agents-only")).toBe(true);
    expect(hasPlugin(config, "conflict-workflow")).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Already active
  // -----------------------------------------------------------------------

  test("reports already active when no changes needed", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    const result = await switchWorkflows({
      projectDir,
      names: ["basic-workflow"],
    });

    expect(result.alreadyActive).toBe(true);
    expect(result.disabled.length).toBe(0);
  });

  test("keeps already-enabled target and disables non-targets", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });

    // basic-workflow is already enabled; switch should keep it and disable agents-only
    const result = await switchWorkflows({
      projectDir,
      names: ["basic-workflow"],
    });

    expect(result.alreadyActive).toBe(false);
    expect(result.disabled.length).toBe(1);
    expect(result.disabled[0].workflowName).toBe("agents-only");

    const config = await readConfig(projectDir);
    expect(hasPlugin(config, "basic-workflow")).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Enables disabled targets
  // -----------------------------------------------------------------------

  test("enables a disabled target workflow", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });

    // Disable basic-workflow manually
    const { writeConfig, removePlugin } = await import(
      "../../src/workflows/config"
    );
    let config = await readConfig(projectDir);
    removePlugin(config, "basic-workflow");
    await writeConfig(projectDir, config);

    // Switch to basic-workflow (currently disabled) — should enable it and disable agents-only
    const result = await switchWorkflows({
      projectDir,
      names: ["basic-workflow"],
    });

    expect(result.alreadyActive).toBe(false);

    config = await readConfig(projectDir);
    expect(hasPlugin(config, "basic-workflow")).toBe(true);
    expect(hasPlugin(config, "agents-only")).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Skill syncing
  // -----------------------------------------------------------------------

  test("unsyncs disabled workflow skills and syncs enabled workflow skills", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });

    // basic-workflow has skill "analysis" — should be synced after install
    const skillDir = join(projectDir, ".opencode", "skills", "analysis");
    expect(await fileExists(skillDir)).toBe(true);

    // Switch to agents-only (no skills) — basic-workflow gets disabled
    const result = await switchWorkflows({
      projectDir,
      names: ["agents-only"],
    });

    // basic-workflow's synced skill should be removed
    expect(await fileExists(skillDir)).toBe(false);
    expect(result.syncWarnings).toEqual([]);
  });

  test("syncs skills when enabling a disabled workflow via switch", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });

    // Switch to agents-only first — removes basic-workflow's skills
    await switchWorkflows({ projectDir, names: ["agents-only"] });
    const skillDir = join(projectDir, ".opencode", "skills", "analysis");
    expect(await fileExists(skillDir)).toBe(false);

    // Switch back to basic-workflow — should re-sync skills
    await switchWorkflows({ projectDir, names: ["basic-workflow"] });
    expect(await fileExists(skillDir)).toBe(true);
    expect(await fileExists(join(skillDir, "SKILL.md"))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Collision detection
  // -----------------------------------------------------------------------

  test("detects collision on newly enabled workflow", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({
      projectDir,
      spec: `file:${fixtureDir("conflict-workflow")}`,
    });

    // Disable both, then switch to both — should warn about "reviewer" collision
    const { writeConfig: wc, removePlugin: rp } = await import(
      "../../src/workflows/config"
    );
    let config = await readConfig(projectDir);
    rp(config, "basic-workflow");
    rp(config, "conflict-workflow");
    await wc(projectDir, config);

    const result = await switchWorkflows({
      projectDir,
      names: ["basic-workflow", "conflict-workflow"],
    });

    // The second workflow enabled should detect the cross-workflow collision
    // Note: basic-workflow is added first, so conflict-workflow sees the collision
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    const crossWarnings = result.warnings.filter(
      (w) => w.type === "cross-workflow",
    );
    expect(crossWarnings.length).toBeGreaterThanOrEqual(1);
    expect(crossWarnings.some((w) => w.name === "reviewer")).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Errors
  // -----------------------------------------------------------------------

  test("errors when workflow not found", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    await expect(
      switchWorkflows({ projectDir, names: ["nonexistent"] }),
    ).rejects.toThrow('Workflow "nonexistent" is not installed.');
  });

  test("errors when no workflows installed", async () => {
    await expect(
      switchWorkflows({ projectDir, names: ["anything"] }),
    ).rejects.toThrow("No workflows installed.");
  });

  test("errors when no names specified", async () => {
    await expect(switchWorkflows({ projectDir, names: [] })).rejects.toThrow(
      "No workflow names specified.",
    );
  });

  // -----------------------------------------------------------------------
  // Atomicity — single config write
  // -----------------------------------------------------------------------

  test("atomic: all changes in one write", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });
    await install({
      projectDir,
      spec: `file:${fixtureDir("conflict-workflow")}`,
    });

    await switchWorkflows({ projectDir, names: ["agents-only"] });

    // Verify the final state is consistent
    const config = await readConfig(projectDir);
    expect(hasPlugin(config, "agents-only")).toBe(true);
    expect(hasPlugin(config, "basic-workflow")).toBe(false);
    expect(hasPlugin(config, "conflict-workflow")).toBe(false);
  });
});

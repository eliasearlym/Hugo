import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTempDir, fixtureDir } from "../helpers";
import { install } from "../../src/commands/install";
import { health } from "../../src/commands/health";
import {
  readConfig,
  writeConfig,
  removePlugin,
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
 * Helper: install a workflow then disable it.
 */
async function installAndDisable(fixtureName: string): Promise<void> {
  await install({ projectDir, spec: `file:${fixtureDir(fixtureName)}` });
  const config = await readConfig(projectDir);
  removePlugin(config, fixtureName);
  await writeConfig(projectDir, config);
}

describe("health", () => {
  // -----------------------------------------------------------------------
  // All healthy
  // -----------------------------------------------------------------------

  test("reports no issues for healthy workflow", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    const result = await health({ projectDir });

    expect(result.reports.length).toBe(1);
    expect(result.reports[0].workflow).toBe("basic-workflow");
    expect(result.reports[0].enabled).toBe(true);
    expect(result.reports[0].warnings.length).toBe(0);
  });

  test("reports no issues for multiple healthy workflows", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({ projectDir, spec: `file:${fixtureDir("agents-only")}` });

    const result = await health({ projectDir });

    expect(result.reports.length).toBe(2);
    expect(result.reports.every((r) => r.warnings.length === 0)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Cross-workflow collisions
  // -----------------------------------------------------------------------

  test("detects cross-workflow collision between enabled workflows", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await install({
      projectDir,
      spec: `file:${fixtureDir("conflict-workflow")}`,
    });

    const result = await health({ projectDir });

    // Both workflows declare agent "reviewer" — both should show a warning
    const bwReport = result.reports.find(
      (r) => r.workflow === "basic-workflow",
    );
    const cwReport = result.reports.find(
      (r) => r.workflow === "conflict-workflow",
    );

    expect(bwReport?.warnings.length).toBeGreaterThanOrEqual(1);
    expect(cwReport?.warnings.length).toBeGreaterThanOrEqual(1);

    const bwCross = bwReport?.warnings.filter(
      (w) => w.type === "cross-workflow",
    );
    const cwCross = cwReport?.warnings.filter(
      (w) => w.type === "cross-workflow",
    );
    expect(bwCross?.some((w) => w.name === "reviewer")).toBe(true);
    expect(cwCross?.some((w) => w.name === "reviewer")).toBe(true);
  });

  // -----------------------------------------------------------------------
  // .opencode/ file overrides
  // -----------------------------------------------------------------------

  test("detects .opencode/ file override", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    // Create a user agent file that shadows the workflow's agent
    const agentsDir = join(projectDir, ".opencode", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "reviewer.md"), "# My custom reviewer");

    const result = await health({ projectDir });

    const report = result.reports[0];
    const fileWarnings = report.warnings.filter(
      (w) => w.type === "overridden-by-file",
    );
    expect(fileWarnings.length).toBe(1);
    expect(fileWarnings[0].name).toBe("reviewer");
    expect(fileWarnings[0].entity).toBe("agent");
  });

  test("detects .opencode/commands/ file override", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    const commandsDir = join(projectDir, ".opencode", "commands");
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, "review.md"), "# My custom review");

    const result = await health({ projectDir });

    const report = result.reports[0];
    const fileWarnings = report.warnings.filter(
      (w) => w.type === "overridden-by-file" && w.entity === "command",
    );
    expect(fileWarnings.length).toBe(1);
    expect(fileWarnings[0].name).toBe("review");
  });

  // -----------------------------------------------------------------------
  // User config overrides
  // -----------------------------------------------------------------------

  test("detects user config agent override", async () => {
    // Set up config with a user-defined agent that conflicts
    await writeFile(
      join(projectDir, "opencode.json"),
      JSON.stringify({ agent: { reviewer: { description: "my reviewer" } } }),
    );

    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });

    const result = await health({ projectDir });

    const report = result.reports[0];
    const configWarnings = report.warnings.filter(
      (w) => w.type === "overridden-by-user-config",
    );
    expect(configWarnings.length).toBe(1);
    expect(configWarnings[0].name).toBe("reviewer");
    expect(configWarnings[0].entity).toBe("agent");
  });

  // -----------------------------------------------------------------------
  // Scope: no args → enabled only
  // -----------------------------------------------------------------------

  test("no args: only checks enabled workflows", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await installAndDisable("agents-only");

    const result = await health({ projectDir });

    // Should only have a report for basic-workflow (enabled)
    expect(result.reports.length).toBe(1);
    expect(result.reports[0].workflow).toBe("basic-workflow");
    expect(result.reports[0].enabled).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Scope: specific name
  // -----------------------------------------------------------------------

  test("specific name: checks that workflow regardless of enabled/disabled", async () => {
    await installAndDisable("basic-workflow");

    const result = await health({ projectDir, name: "basic-workflow" });

    expect(result.reports.length).toBe(1);
    expect(result.reports[0].workflow).toBe("basic-workflow");
    expect(result.reports[0].enabled).toBe(false);
  });

  test("specific name: errors if not found", async () => {
    await expect(
      health({ projectDir, name: "nonexistent" }),
    ).rejects.toThrow('Workflow "nonexistent" is not installed.');
  });

  // -----------------------------------------------------------------------
  // Scope: --all
  // -----------------------------------------------------------------------

  test("--all: checks all workflows including disabled", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await installAndDisable("agents-only");

    const result = await health({ projectDir, all: true });

    expect(result.reports.length).toBe(2);

    const bwReport = result.reports.find(
      (r) => r.workflow === "basic-workflow",
    );
    const aoReport = result.reports.find((r) => r.workflow === "agents-only");

    expect(bwReport?.enabled).toBe(true);
    expect(aoReport?.enabled).toBe(false);
  });

  test("--all: detects collision between disabled and enabled workflow", async () => {
    // Install basic-workflow (enabled, has agent "reviewer")
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    // Install conflict-workflow (disabled, also has agent "reviewer")
    await installAndDisable("conflict-workflow");

    const result = await health({ projectDir, all: true });

    // conflict-workflow is disabled but --all uses all-installed cross-check scope
    // so it should detect the collision with enabled basic-workflow
    const cwReport = result.reports.find(
      (r) => r.workflow === "conflict-workflow",
    );
    expect(cwReport).toBeDefined();
    const crossWarnings =
      cwReport?.warnings.filter((w) => w.type === "cross-workflow") ?? [];
    expect(crossWarnings.length).toBeGreaterThanOrEqual(1);
    expect(crossWarnings[0].name).toBe("reviewer");
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  test("errors when no workflows installed", async () => {
    await expect(health({ projectDir })).rejects.toThrow(
      "No workflows installed.",
    );
  });

  test("returns empty reports when no enabled workflows exist (no args)", async () => {
    await installAndDisable("basic-workflow");

    // No args → enabled only → no enabled workflows → empty reports
    const result = await health({ projectDir });
    expect(result.reports.length).toBe(0);
  });

  test("reports enabled status correctly in results", async () => {
    await install({ projectDir, spec: `file:${fixtureDir("basic-workflow")}` });
    await installAndDisable("agents-only");

    const result = await health({ projectDir, all: true });

    const bwReport = result.reports.find(
      (r) => r.workflow === "basic-workflow",
    );
    const aoReport = result.reports.find((r) => r.workflow === "agents-only");

    expect(bwReport?.enabled).toBe(true);
    expect(aoReport?.enabled).toBe(false);
  });
});

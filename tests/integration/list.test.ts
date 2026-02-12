import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTempDir, fixtureDir } from "../helpers";
import { install } from "../../src/commands/install";
import { list } from "../../src/commands/list";
import { readConfig, removePlugin, writeConfig } from "../../src/workflows/config";

let projectDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: projectDir, cleanup } = await createTempDir());
});

afterEach(async () => {
  await cleanup();
});

describe("list", () => {
  test("returns empty array when no workflows installed", async () => {
    const result = await list({ projectDir });
    expect(result.workflows).toEqual([]);
  });

  test("lists single installed workflow", async () => {
    await install({
      projectDir,
      spec: `file:${fixtureDir("basic-workflow")}`,
    });

    const result = await list({ projectDir });
    expect(result.workflows.length).toBe(1);

    const wf = result.workflows[0];
    expect(wf.workflowName).toBe("basic-workflow");
    expect(wf.packageName).toBe("basic-workflow");
    expect(wf.version).toBe("1.0.0");
    expect(wf.enabled).toBe(true);
    expect(wf.agents).toEqual(["reviewer"]);
    expect(wf.commands).toEqual(["review"]);
    expect(wf.skills).toEqual(["analysis"]);
    expect(wf.mcps).toEqual([]);
  });

  test("lists multiple workflows", async () => {
    await install({
      projectDir,
      spec: `file:${fixtureDir("basic-workflow")}`,
    });
    await install({
      projectDir,
      spec: `file:${fixtureDir("agents-only")}`,
    });

    const result = await list({ projectDir });
    expect(result.workflows.length).toBe(2);

    const names = result.workflows.map((w) => w.workflowName);
    expect(names).toContain("basic-workflow");
    expect(names).toContain("agents-only");
  });

  test("shows disabled status when removed from plugin array", async () => {
    await install({
      projectDir,
      spec: `file:${fixtureDir("basic-workflow")}`,
    });

    // Disable by removing from plugin array
    const config = await readConfig(projectDir);
    removePlugin(config, "basic-workflow");
    await writeConfig(projectDir, config);

    const result = await list({ projectDir });
    expect(result.workflows[0].enabled).toBe(false);
  });

  test("filters by name", async () => {
    await install({
      projectDir,
      spec: `file:${fixtureDir("basic-workflow")}`,
    });
    await install({
      projectDir,
      spec: `file:${fixtureDir("agents-only")}`,
    });

    const result = await list({ projectDir, name: "agents-only" });
    expect(result.workflows.length).toBe(1);
    expect(result.workflows[0].workflowName).toBe("agents-only");
  });

  test("errors when specific workflow not found", async () => {
    await expect(
      list({ projectDir, name: "nonexistent" }),
    ).rejects.toThrow('Workflow "nonexistent" is not installed.');
  });
});

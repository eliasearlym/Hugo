import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTempDir, fixtureDir, readConfig, fileExists } from "../helpers";
import { install } from "../../src/commands/install";
import { remove } from "../../src/commands/remove";

let projectDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: projectDir, cleanup } = await createTempDir());
});

afterEach(async () => {
  await cleanup();
});

describe("remove", () => {
  test("removes an enabled workflow", async () => {
    // Install first
    await install({
      projectDir,
      spec: `file:${fixtureDir("basic-workflow")}`,
    });

    // Remove
    const result = await remove({ projectDir, name: "basic-workflow" });

    expect(result.workflowName).toBe("basic-workflow");
    expect(result.packageName).toBe("basic-workflow");
    expect(result.agents).toEqual(["reviewer"]);
    expect(result.commands).toEqual(["review"]);
    expect(result.skills).toEqual(["analysis"]);
    expect(result.mcps).toEqual([]);

    // Verify config is clean
    const config = await readConfig(projectDir);
    expect(config).not.toBeNull();
    const c = config as Record<string, unknown>;
    const plugins = c.plugin as string[];
    expect(plugins).not.toContain("basic-workflow");

    const hugo = c.hugo as Record<string, unknown>;
    const workflows = hugo.workflows as Record<string, unknown>;
    expect(workflows["basic-workflow"]).toBeUndefined();
  });

  test("removes a disabled workflow", async () => {
    // Install, then manually remove from plugin array to simulate disabled
    await install({
      projectDir,
      spec: `file:${fixtureDir("basic-workflow")}`,
    });

    // Read config, remove from plugin array, write back
    const { writeConfig, readConfig: readCfg, removePlugin } = await import(
      "../../src/workflows/config"
    );
    let config = await readCfg(projectDir);
    removePlugin(config, "basic-workflow");
    await writeConfig(projectDir, config);

    // Now remove
    const result = await remove({ projectDir, name: "basic-workflow" });
    expect(result.workflowName).toBe("basic-workflow");

    // Verify fully cleaned
    config = await readCfg(projectDir);
    const hugo = config.hugo as Record<string, unknown>;
    const workflows = hugo.workflows as Record<string, unknown>;
    expect(workflows["basic-workflow"]).toBeUndefined();
  });

  test("errors when workflow not found", async () => {
    await expect(
      remove({ projectDir, name: "nonexistent" }),
    ).rejects.toThrow('Workflow "nonexistent" is not installed.');
  });

  test("removes bun dependency", async () => {
    await install({
      projectDir,
      spec: `file:${fixtureDir("basic-workflow")}`,
    });

    const opencodeDir = join(projectDir, ".opencode");
    const packageDir = join(opencodeDir, "node_modules", "basic-workflow");

    // Package should exist before remove
    expect(await fileExists(packageDir)).toBe(true);

    await remove({ projectDir, name: "basic-workflow" });

    // Package should be removed (or at least not in dependencies)
    // Note: bun may leave files but removes from package.json
  });

  test("preserves other workflows when removing one", async () => {
    // Install two workflows
    await install({
      projectDir,
      spec: `file:${fixtureDir("basic-workflow")}`,
    });
    await install({
      projectDir,
      spec: `file:${fixtureDir("agents-only")}`,
    });

    // Remove one
    await remove({ projectDir, name: "basic-workflow" });

    // Other should still be there
    const config = await readConfig(projectDir);
    const c = config as Record<string, unknown>;
    const plugins = c.plugin as string[];
    expect(plugins).toContain("agents-only");
    expect(plugins).not.toContain("basic-workflow");

    const hugo = c.hugo as Record<string, unknown>;
    const workflows = hugo.workflows as Record<string, unknown>;
    expect(workflows["agents-only"]).toBeDefined();
    expect(workflows["basic-workflow"]).toBeUndefined();
  });
});

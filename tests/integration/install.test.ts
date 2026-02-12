import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { createTempDir, fixtureDir, stageFixture, readConfig } from "../helpers";
import { install } from "../../src/commands/install";

let projectDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: projectDir, cleanup } = await createTempDir());
});

afterEach(async () => {
  await cleanup();
});

describe("install", () => {
  test("installs a workflow from file: source", async () => {
    const spec = `file:${fixtureDir("basic-workflow")}`;
    const result = await install({ projectDir, spec });

    expect(result.workflowName).toBe("basic-workflow");
    expect(result.packageName).toBe("basic-workflow");
    expect(result.version).toBe("1.0.0");
    expect(result.agents).toEqual(["reviewer"]);
    expect(result.commands).toEqual(["review"]);
    expect(result.skills).toEqual(["analysis"]);
    expect(result.mcps).toEqual([]);

    // Verify config was written
    const config = await readConfig(projectDir);
    expect(config).not.toBeNull();
    expect((config as Record<string, unknown>).plugin).toContain(
      "basic-workflow",
    );

    const hugo = (config as Record<string, unknown>).hugo as Record<
      string,
      unknown
    >;
    const workflows = hugo.workflows as Record<string, unknown>;
    expect(workflows["basic-workflow"]).toBeDefined();
  });

  test("installs agents-only workflow", async () => {
    const spec = `file:${fixtureDir("agents-only")}`;
    const result = await install({ projectDir, spec });

    expect(result.workflowName).toBe("agents-only");
    expect(result.agents).toEqual(["planner", "executor"]);
    expect(result.commands).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.mcps).toEqual([]);
  });

  test("errors when workflow already installed", async () => {
    const spec = `file:${fixtureDir("basic-workflow")}`;
    await install({ projectDir, spec });

    await expect(install({ projectDir, spec })).rejects.toThrow(
      "is already installed",
    );
  });

  test("--force reinstalls already-installed workflow", async () => {
    const spec = `file:${fixtureDir("basic-workflow")}`;
    await install({ projectDir, spec });

    const result = await install({ projectDir, spec, force: true });
    expect(result.workflowName).toBe("basic-workflow");
    expect(result.version).toBe("1.0.0");
  });

  test("errors when package has no manifest", async () => {
    const spec = `file:${fixtureDir("no-manifest")}`;
    await expect(install({ projectDir, spec })).rejects.toThrow(
      "missing workflow.json",
    );
  });

  test("errors when package has invalid manifest", async () => {
    const spec = `file:${fixtureDir("bad-manifest")}`;
    await expect(install({ projectDir, spec })).rejects.toThrow(
      "invalid workflow.json",
    );
  });

  test("rollback removes package on manifest error", async () => {
    const spec = `file:${fixtureDir("no-manifest")}`;
    try {
      await install({ projectDir, spec });
    } catch {
      // expected
    }

    // Config should be clean — no plugin entry, no hugo state
    const config = await readConfig(projectDir);
    if (config) {
      const plugins = (config as Record<string, unknown>).plugin;
      expect(plugins).toBeUndefined();
    }
  });

  test("detects collision with .opencode/ user file", async () => {
    // Create a user file that collides
    const agentsDir = join(projectDir, ".opencode", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "reviewer.md"), "# My custom reviewer");

    const spec = `file:${fixtureDir("basic-workflow")}`;
    const result = await install({ projectDir, spec });

    const fileWarnings = result.warnings.filter(
      (w) => w.type === "overridden-by-file",
    );
    expect(fileWarnings.length).toBe(1);
    expect(fileWarnings[0].entity).toBe("agent");
    expect(fileWarnings[0].name).toBe("reviewer");
  });

  test("detects collision with user config entry", async () => {
    // Create config with a user-defined agent
    await writeFile(
      join(projectDir, "opencode.json"),
      JSON.stringify({
        agent: { reviewer: { description: "my reviewer" } },
      }),
    );

    const spec = `file:${fixtureDir("basic-workflow")}`;
    const result = await install({ projectDir, spec });

    const configWarnings = result.warnings.filter(
      (w) => w.type === "overridden-by-user-config",
    );
    expect(configWarnings.length).toBe(1);
    expect(configWarnings[0].entity).toBe("agent");
    expect(configWarnings[0].name).toBe("reviewer");
  });

  test("detects cross-workflow collision", async () => {
    // Install first workflow
    await install({
      projectDir,
      spec: `file:${fixtureDir("basic-workflow")}`,
    });

    // Install second workflow that has the same agent name
    const result = await install({
      projectDir,
      spec: `file:${fixtureDir("conflict-workflow")}`,
    });

    const crossWarnings = result.warnings.filter(
      (w) => w.type === "cross-workflow",
    );
    expect(crossWarnings.length).toBe(1);
    expect(crossWarnings[0].entity).toBe("agent");
    expect(crossWarnings[0].name).toBe("reviewer");
  });

  test("installs empty workflow (no agents/commands/skills)", async () => {
    const spec = `file:${fixtureDir("empty-workflow")}`;
    const result = await install({ projectDir, spec });

    expect(result.workflowName).toBe("empty-workflow");
    expect(result.agents).toEqual([]);
    expect(result.commands).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.mcps).toEqual([]);
  });

  test("preserves existing config keys", async () => {
    // Pre-populate config with user settings
    await writeFile(
      join(projectDir, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        theme: "dark",
        mcp: { some_server: {} },
      }),
    );

    const spec = `file:${fixtureDir("basic-workflow")}`;
    await install({ projectDir, spec });

    const config = await readConfig(projectDir);
    expect(config).not.toBeNull();
    expect((config as Record<string, unknown>).$schema).toBe(
      "https://opencode.ai/config.json",
    );
    expect((config as Record<string, unknown>).theme).toBe("dark");
    expect((config as Record<string, unknown>).mcp).toEqual({
      some_server: {},
    });
  });

  test("errors when workflow name conflicts with different package (file source)", async () => {
    // Install basic-workflow from original package
    await install({
      projectDir,
      spec: `file:${fixtureDir("basic-workflow")}`,
    });

    // Try to force-install scoped package that derives to the same workflow name.
    // @other-org/basic-workflow → deriveWorkflowName → "basic-workflow"
    // Without --force, the "already installed" check fires first.
    // With --force, the package-name-mismatch check is reached.
    await expect(
      install({
        projectDir,
        spec: `file:${fixtureDir("scoped-basic-workflow")}`,
        force: true,
      }),
    ).rejects.toThrow(
      'Workflow name "basic-workflow" conflicts with already-installed workflow from package "basic-workflow"',
    );
  });

  test("rollback removes package when package.json is corrupt in installed dir", async () => {
    // Use a staged copy so corrupting package.json doesn't affect the shared fixture.
    // stageFixture creates an isolated copy we can safely mutate.
    const staged = await stageFixture("basic-workflow");
    try {
      // First, install normally
      await install({ projectDir, spec: staged.spec });

      // Corrupt the package.json in the staged source directory.
      // Since bun file: installs link/copy from the source, this
      // ensures the next bun add will install a package with corrupt JSON.
      await writeFile(join(staged.dir, "package.json"), "{{not valid json");

      // Force reinstall — bun add will fail because the source package.json is corrupt
      await expect(
        install({ projectDir, spec: staged.spec, force: true }),
      ).rejects.toThrow();

      // Config should still have the original workflow from the first install
      // (the failed reinstall should not have corrupted state)
      const config = await readConfig(projectDir);
      expect(config).not.toBeNull();
      const hugo = (config as Record<string, unknown>).hugo as Record<
        string,
        unknown
      >;
      const workflows = hugo.workflows as Record<string, unknown>;
      expect(workflows["basic-workflow"]).toBeDefined();
    } finally {
      await staged.cleanup();
    }
  });
});

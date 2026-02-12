import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createTempDir, fixtureDir, runCLI, readConfig } from "../helpers";

/**
 * End-to-end lifecycle test.
 *
 * Tests the full CLI flow against a real workflow package fixture:
 * install → list → disable → enable → switch → health → remove.
 *
 * Also tests the build command authoring flow.
 */

let projectDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: projectDir, cleanup } = await createTempDir());
});

afterEach(async () => {
  await cleanup();
});

function hugo(...args: string[]) {
  return runCLI(args, { cwd: projectDir });
}

describe("e2e: full lifecycle", () => {
  test("install → list → disable → enable → switch → health → remove", async () => {
    // ---- Install two workflows ----
    const install1 = await hugo(
      "install",
      `file:${fixtureDir("basic-workflow")}`,
    );
    expect(install1.exitCode).toBe(0);
    expect(install1.stdout).toContain('Installed "basic-workflow" v1.0.0');

    const install2 = await hugo(
      "install",
      `file:${fixtureDir("agents-only")}`,
    );
    expect(install2.exitCode).toBe(0);
    expect(install2.stdout).toContain('Installed "agents-only" v1.0.0');

    // ---- List ----
    const list1 = await hugo("list");
    expect(list1.exitCode).toBe(0);
    expect(list1.stdout).toContain("Installed workflows:");
    expect(list1.stdout).toContain("basic-workflow");
    expect(list1.stdout).toContain("agents-only");
    expect(list1.stdout).toContain("(enabled)");

    // ---- Verify config state ----
    let config = await readConfig(projectDir);
    expect(config).not.toBeNull();
    const plugins = (config as Record<string, unknown>).plugin as string[];
    expect(plugins).toContain("basic-workflow");
    expect(plugins).toContain("agents-only");

    // ---- Disable one ----
    const disable1 = await hugo("disable", "basic-workflow");
    expect(disable1.exitCode).toBe(0);
    expect(disable1.stdout).toContain('Disabled "basic-workflow"');

    // Verify list shows disabled status
    const list2 = await hugo("list", "basic-workflow");
    expect(list2.exitCode).toBe(0);
    expect(list2.stdout).toContain("(disabled)");

    // ---- Re-enable ----
    const enable1 = await hugo("enable", "basic-workflow");
    expect(enable1.exitCode).toBe(0);
    expect(enable1.stdout).toContain('Enabled "basic-workflow"');

    // ---- Switch to agents-only only ----
    const switch1 = await hugo("switch", "agents-only");
    expect(switch1.exitCode).toBe(0);
    expect(switch1.stdout).toContain('Switched to "agents-only"');
    expect(switch1.stdout).toContain("disabled: basic-workflow");

    // Verify only agents-only is enabled
    const list3 = await hugo("list");
    expect(list3.exitCode).toBe(0);
    expect(list3.stdout).toContain("(enabled)");
    expect(list3.stdout).toContain("(disabled)");

    // ---- Health check ----
    const health1 = await hugo("health");
    expect(health1.exitCode).toBe(0);
    // Only agents-only is enabled, no collisions
    expect(health1.stdout).toContain("All workflows healthy.");

    // ---- Health --all shows both ----
    const health2 = await hugo("health", "--all");
    expect(health2.exitCode).toBe(0);
    expect(health2.stdout).toContain("(enabled)");
    expect(health2.stdout).toContain("(disabled)");

    // ---- Remove one ----
    const remove1 = await hugo("remove", "basic-workflow");
    expect(remove1.exitCode).toBe(0);
    expect(remove1.stdout).toContain('Removed "basic-workflow"');

    // Verify it's gone from list
    const list4 = await hugo("list");
    expect(list4.exitCode).toBe(0);
    expect(list4.stdout).not.toContain("basic-workflow");
    expect(list4.stdout).toContain("agents-only");

    // ---- Remove the other ----
    const remove2 = await hugo("remove", "agents-only");
    expect(remove2.exitCode).toBe(0);

    // ---- Verify clean state ----
    const list5 = await hugo("list");
    expect(list5.exitCode).toBe(0);
    expect(list5.stdout).toContain("No workflows installed.");

    config = await readConfig(projectDir);
    expect(config).not.toBeNull();
    const hugo_state = (config as Record<string, unknown>).hugo as
      | Record<string, unknown>
      | undefined;
    if (hugo_state) {
      const workflows = hugo_state.workflows as Record<string, unknown>;
      expect(Object.keys(workflows).length).toBe(0);
    }
  });
});

describe("e2e: build authoring flow", () => {
  test("author creates workflow package from scratch", async () => {
    // Set up a package directory as a workflow author would
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "@my-org/code-review",
        version: "1.0.0",
        description: "Code review workflow for OpenCode",
      }),
    );

    // Create agents
    await mkdir(join(projectDir, "agents"), { recursive: true });
    await writeFile(
      join(projectDir, "agents", "reviewer.md"),
      "---\ndescription: Reviews code\n---\n# Reviewer",
    );
    await writeFile(
      join(projectDir, "agents", "linter.md"),
      "---\ndescription: Lints code\n---\n# Linter",
    );

    // Create commands
    await mkdir(join(projectDir, "commands"), { recursive: true });
    await writeFile(
      join(projectDir, "commands", "review.md"),
      "---\ndescription: Start a review\n---\n# /review",
    );

    // Create skills
    const skillDir = join(projectDir, "skills", "analysis");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Analysis skill");

    // ---- Build ----
    const build1 = await hugo("build");
    expect(build1.exitCode).toBe(0);
    expect(build1.stdout).toContain("Built workflow.json");
    expect(build1.stdout).toContain("2 agents");
    expect(build1.stdout).toContain("1 command");
    expect(build1.stdout).toContain("1 skill");

    // ---- Verify generated manifest ----
    const manifest = JSON.parse(
      await readFile(join(projectDir, "workflow.json"), "utf-8"),
    );
    expect(manifest.agents).toEqual(["linter", "reviewer"]);
    expect(manifest.commands).toEqual(["review"]);
    expect(manifest.skills).toEqual(["analysis"]);
  });
});

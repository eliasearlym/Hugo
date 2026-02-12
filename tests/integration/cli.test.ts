import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createTempDir, fixtureDir, runCLI } from "../helpers";

let projectDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: projectDir, cleanup } = await createTempDir());
});

afterEach(async () => {
  await cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run hugo CLI with cwd set to the temp project directory. */
function hugo(...args: string[]) {
  return runCLI(args, { cwd: projectDir });
}

/** Install a fixture via CLI for tests that need a pre-installed workflow. */
async function installFixture(name: string) {
  return hugo("install", `file:${fixtureDir(name)}`);
}

// ---------------------------------------------------------------------------
// Global / help
// ---------------------------------------------------------------------------

describe("cli: global", () => {
  test("--help prints help text", async () => {
    const { stdout, exitCode } = await hugo("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("hugo — workflow manager for OpenCode");
    expect(stdout).toContain("hugo install <package>");
  });

  test("-h prints help text", async () => {
    const { stdout, exitCode } = await hugo("-h");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("hugo — workflow manager for OpenCode");
  });

  test("no args prints help text", async () => {
    const { stdout, exitCode } = await hugo();
    expect(exitCode).toBe(0);
    expect(stdout).toContain("hugo — workflow manager for OpenCode");
  });

  test("unknown command prints error and help", async () => {
    const { stderr, stdout, exitCode } = await hugo("badcommand");
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown command "badcommand"');
    expect(stdout).toContain("hugo — workflow manager for OpenCode");
  });

  test("unknown flag prints error and help", async () => {
    const { stderr, stdout, exitCode } = await hugo("install", "--forse", "@org/pkg");
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown flag "--forse"');
    expect(stdout).toContain("hugo — workflow manager for OpenCode");
  });

  test("unknown short flag prints error and help", async () => {
    const { stderr, stdout, exitCode } = await hugo("install", "-v", "@org/pkg");
    expect(exitCode).toBe(1);
    expect(stderr).toContain('unknown flag "-v"');
    expect(stdout).toContain("hugo — workflow manager for OpenCode");
  });
});

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

describe("cli: install", () => {
  test("installs a workflow and prints success", async () => {
    const { stdout, exitCode } = await installFixture("basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Installed "basic-workflow"');
    expect(stdout).toContain("v1.0.0");
    expect(stdout).toContain("1 agent");
    expect(stdout).toContain("1 command");
    expect(stdout).toContain("1 skill");
  });

  test("alias 'i' works", async () => {
    const { stdout, exitCode } = await hugo(
      "i",
      `file:${fixtureDir("basic-workflow")}`,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Installed "basic-workflow"');
  });

  test("errors with no package spec", async () => {
    const { stderr, exitCode } = await hugo("install");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("missing package spec");
    expect(stderr).toContain("Usage: hugo install <package>");
  });

  test("errors on already installed", async () => {
    await installFixture("basic-workflow");
    const { stderr, exitCode } = await installFixture("basic-workflow");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("is already installed");
  });

  test("--force reinstalls", async () => {
    await installFixture("basic-workflow");
    const { stdout, exitCode } = await hugo(
      "install",
      `file:${fixtureDir("basic-workflow")}`,
      "--force",
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Installed "basic-workflow"');
  });

  test("shows collision warnings", async () => {
    // Create a user file that collides
    const agentsDir = join(projectDir, ".opencode", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "reviewer.md"), "# Custom reviewer");

    const { stdout, exitCode } = await installFixture("basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("\u26A0");
    expect(stdout).toContain('"reviewer"');
    expect(stdout).toContain('Installed "basic-workflow"');
  });
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe("cli: remove", () => {
  test("removes an installed workflow", async () => {
    await installFixture("basic-workflow");
    const { stdout, exitCode } = await hugo("remove", "basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Removed "basic-workflow"');
    expect(stdout).toContain("1 agent");
  });

  test("alias 'rm' works", async () => {
    await installFixture("basic-workflow");
    const { stdout, exitCode } = await hugo("rm", "basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Removed "basic-workflow"');
  });

  test("errors with no name", async () => {
    const { stderr, exitCode } = await hugo("remove");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("missing workflow name");
    expect(stderr).toContain("Usage: hugo remove <name>");
  });

  test("errors when not installed", async () => {
    const { stderr, exitCode } = await hugo("remove", "nonexistent");
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Workflow "nonexistent" is not installed');
  });
});

// ---------------------------------------------------------------------------
// enable / disable
// ---------------------------------------------------------------------------

describe("cli: enable", () => {
  test("enables a disabled workflow", async () => {
    await installFixture("basic-workflow");
    await hugo("disable", "basic-workflow");

    const { stdout, exitCode } = await hugo("enable", "basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Enabled "basic-workflow"');
    expect(stdout).toContain("1 agent");
  });

  test("reports already enabled", async () => {
    await installFixture("basic-workflow");
    const { stdout, exitCode } = await hugo("enable", "basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"basic-workflow" is already enabled');
  });

  test("errors with no name and no --all", async () => {
    const { stderr, exitCode } = await hugo("enable");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("missing workflow name (or use --all)");
  });

  test("--all enables all disabled workflows", async () => {
    await installFixture("basic-workflow");
    await installFixture("agents-only");
    await hugo("disable", "--all");

    const { stdout, exitCode } = await hugo("enable", "--all");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Enabled "basic-workflow"');
    expect(stdout).toContain('Enabled "agents-only"');
  });

  test("--all when all already enabled", async () => {
    await installFixture("basic-workflow");
    const { stdout, exitCode } = await hugo("enable", "--all");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("All workflows are already enabled");
  });
});

describe("cli: disable", () => {
  test("disables an enabled workflow", async () => {
    await installFixture("basic-workflow");
    const { stdout, exitCode } = await hugo("disable", "basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Disabled "basic-workflow"');
  });

  test("reports already disabled", async () => {
    await installFixture("basic-workflow");
    await hugo("disable", "basic-workflow");

    const { stdout, exitCode } = await hugo("disable", "basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"basic-workflow" is already disabled');
  });

  test("errors with no name and no --all", async () => {
    const { stderr, exitCode } = await hugo("disable");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("missing workflow name (or use --all)");
  });

  test("--all disables all enabled workflows", async () => {
    await installFixture("basic-workflow");
    await installFixture("agents-only");

    const { stdout, exitCode } = await hugo("disable", "--all");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Disabled "basic-workflow"');
    expect(stdout).toContain('Disabled "agents-only"');
  });

  test("--all when all already disabled", async () => {
    await installFixture("basic-workflow");
    await hugo("disable", "basic-workflow");

    const { stdout, exitCode } = await hugo("disable", "--all");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("All workflows are already disabled");
  });
});

// ---------------------------------------------------------------------------
// switch
// ---------------------------------------------------------------------------

describe("cli: switch", () => {
  test("switches to a single workflow", async () => {
    await installFixture("basic-workflow");
    await installFixture("agents-only");

    const { stdout, exitCode } = await hugo("switch", "basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Switched to "basic-workflow"');
    expect(stdout).toContain("disabled: agents-only");
  });

  test("reports already active", async () => {
    await installFixture("basic-workflow");

    const { stdout, exitCode } = await hugo("switch", "basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Already active: basic-workflow");
  });

  test("errors with no name", async () => {
    const { stderr, exitCode } = await hugo("switch");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("missing workflow name");
    expect(stderr).toContain("Usage: hugo switch <name...>");
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("cli: list", () => {
  test("lists installed workflows", async () => {
    await installFixture("basic-workflow");
    await installFixture("agents-only");

    const { stdout, exitCode } = await hugo("list");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Installed workflows:");
    expect(stdout).toContain("basic-workflow");
    expect(stdout).toContain("v1.0.0");
    expect(stdout).toContain("(enabled)");
    expect(stdout).toContain("agents-only");
    expect(stdout).toContain("agents: planner, executor");
  });

  test("alias 'ls' works", async () => {
    await installFixture("basic-workflow");
    const { stdout, exitCode } = await hugo("ls");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("basic-workflow");
  });

  test("lists specific workflow", async () => {
    await installFixture("basic-workflow");
    const { stdout, exitCode } = await hugo("list", "basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("basic-workflow");
    expect(stdout).toContain("v1.0.0");
    // Should NOT contain the header when filtering
    expect(stdout).not.toContain("Installed workflows:");
  });

  test("shows disabled status", async () => {
    await installFixture("basic-workflow");
    await hugo("disable", "basic-workflow");

    const { stdout, exitCode } = await hugo("list");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(disabled)");
  });

  test("shows message when no workflows installed", async () => {
    const { stdout, exitCode } = await hugo("list");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No workflows installed.");
  });

  test("errors when specific workflow not found", async () => {
    const { stderr, exitCode } = await hugo("list", "nonexistent");
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Workflow "nonexistent" is not installed');
  });
});

// ---------------------------------------------------------------------------
// health
// ---------------------------------------------------------------------------

describe("cli: health", () => {
  test("reports all healthy", async () => {
    await installFixture("basic-workflow");
    const { stdout, exitCode } = await hugo("health");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("All workflows healthy.");
  });

  test("reports file override collision", async () => {
    await installFixture("basic-workflow");

    // Create a file that overrides the workflow's agent
    const agentsDir = join(projectDir, ".opencode", "agents");
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "reviewer.md"), "# override");

    const { stdout, exitCode } = await hugo("health");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("basic-workflow:");
    expect(stdout).toContain("\u26A0");
    expect(stdout).toContain('"reviewer"');
  });

  test("reports cross-workflow collision", async () => {
    await installFixture("basic-workflow");
    await installFixture("conflict-workflow");

    const { stdout, exitCode } = await hugo("health");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"reviewer"');
  });

  test("--all shows enabled/disabled status", async () => {
    await installFixture("basic-workflow");
    await hugo("disable", "basic-workflow");

    const { stdout, exitCode } = await hugo("health", "--all");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(disabled)");
  });

  test("checks specific workflow", async () => {
    await installFixture("basic-workflow");
    const { stdout, exitCode } = await hugo("health", "basic-workflow");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("basic-workflow:");
  });

  test("errors when specific workflow not found", async () => {
    const { stderr, exitCode } = await hugo("health", "nonexistent");
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Workflow "nonexistent" is not installed');
  });
});

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

describe("cli: build", () => {
  test("builds workflow.json from directory structure", async () => {
    // Set up a workflow package directory
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "test-workflow",
        version: "1.0.0",
        description: "A test workflow",
      }),
    );
    await mkdir(join(projectDir, "agents"), { recursive: true });
    await writeFile(join(projectDir, "agents", "reviewer.md"), "# reviewer");
    await mkdir(join(projectDir, "commands"), { recursive: true });
    await writeFile(join(projectDir, "commands", "review.md"), "# review");

    const { stdout, exitCode } = await hugo("build");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Built workflow.json");
    expect(stdout).toContain("1 agent");
    expect(stdout).toContain("1 command");
  });

  test("errors when no package.json", async () => {
    const { stderr, exitCode } = await hugo("build");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("No package.json found");
  });

  test("shows warnings for missing fields", async () => {
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    );
    await mkdir(join(projectDir, "agents"), { recursive: true });
    await writeFile(join(projectDir, "agents", "test.md"), "# test");

    const { stdout, exitCode } = await hugo("build");
    expect(exitCode).toBe(0);
    expect(stdout).toContain('missing "name" field');
    expect(stdout).toContain('missing "description" field');
    expect(stdout).toContain("Built workflow.json");
  });

  test("errors when nothing to build", async () => {
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0", description: "test" }),
    );

    const { stderr, exitCode } = await hugo("build");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("No agents, commands, or skills found");
  });
});

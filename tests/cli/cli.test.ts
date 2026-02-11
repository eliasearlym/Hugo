import { describe, test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { createTempDir, runCLI, fixtureDir } from "../helpers";
import { install } from "../../src/commands/install";

let cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups) {
    await cleanup();
  }
  cleanups = [];
});

async function setup() {
  const { dir, cleanup } = await createTempDir();
  cleanups.push(cleanup);
  return dir;
}

// --- Argument handling ---

describe("CLI argument handling", () => {
  test("hugo --help prints help text, exit 0", async () => {
    const { stdout, exitCode } = await runCLI(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("hugo — workflow manager");
    expect(stdout).toContain("install");
    expect(stdout).toContain("update");
    expect(stdout).toContain("list");
    expect(stdout).toContain("remove");
    expect(stdout).toContain("status");
  });

  test("hugo (no args) prints help text, exit 0", async () => {
    const { stdout, exitCode } = await runCLI([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("hugo — workflow manager");
  });

  test("hugo unknowncommand prints error, exit 1", async () => {
    const { stderr, exitCode } = await runCLI(["unknowncommand"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command");
  });

  test("hugo install (no package) prints error, exit 1", async () => {
    const { stderr, exitCode } = await runCLI(["install"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("missing package spec");
  });

  test("hugo remove (no name) prints error, exit 1", async () => {
    const { stderr, exitCode } = await runCLI(["remove"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("missing workflow name");
  });
});

// --- Output formatting ---

describe("CLI output formatting", () => {
  test("install success output contains workflow name, version, counts", async () => {
    const cwd = await setup();
    const fixture = fixtureDir("basic-workflow");
    const { stdout, exitCode } = await runCLI(["install", `file:${fixture}`], { cwd });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("basic-workflow");
    expect(stdout).toContain("v1.0.0");
    expect(stdout).toContain("1 agents");
    expect(stdout).toContain("1 skills");
    expect(stdout).toContain("1 commands");
  }, 15_000);

  test("list output with workflows shows header and entries", async () => {
    const cwd = await setup();
    // CLI reads from cwd/.opencode, so install there
    await install(join(cwd, ".opencode"), `file:${fixtureDir("basic-workflow")}`);

    const { stdout, exitCode } = await runCLI(["list"], { cwd });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Installed workflows:");
    expect(stdout).toContain("basic-workflow");
    expect(stdout).toContain("v1.0.0");
  }, 15_000);

  test("list output empty shows 'No workflows installed.'", async () => {
    const cwd = await setup();
    const { stdout, exitCode } = await runCLI(["list"], { cwd });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("No workflows installed.");
  });

  test("status output for clean install shows clean counts", async () => {
    const cwd = await setup();
    await install(join(cwd, ".opencode"), `file:${fixtureDir("basic-workflow")}`);

    const { stdout, exitCode } = await runCLI(["status"], { cwd });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("basic-workflow");
    expect(stdout).toContain("clean");
    expect(stdout).toContain("0 modified");
    expect(stdout).toContain("0 deleted");
  }, 15_000);

  test("remove output shows file counts", async () => {
    const cwd = await setup();
    await install(join(cwd, ".opencode"), `file:${fixtureDir("basic-workflow")}`);

    const { stdout, exitCode } = await runCLI(["remove", "basic-workflow"], { cwd });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Removed workflow");
    expect(stdout).toContain("basic-workflow");
    expect(stdout).toContain("files removed");
  }, 15_000);

  test("error output goes to stderr with 'Error:' prefix", async () => {
    const cwd = await setup();
    const { stderr, exitCode } = await runCLI(["remove", "nonexistent"], { cwd });

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Error:");
  });
});

// --- Exit codes ---

describe("CLI exit codes", () => {
  test("successful install exits 0", async () => {
    const cwd = await setup();
    const { exitCode } = await runCLI(["install", `file:${fixtureDir("basic-workflow")}`], { cwd });
    expect(exitCode).toBe(0);
  }, 15_000);

  test("successful list exits 0", async () => {
    const cwd = await setup();
    const { exitCode } = await runCLI(["list"], { cwd });
    expect(exitCode).toBe(0);
  });

  test("successful status exits 0", async () => {
    const cwd = await setup();
    const { exitCode } = await runCLI(["status"], { cwd });
    expect(exitCode).toBe(0);
  });

  test("failed install exits 1", async () => {
    const cwd = await setup();
    const { exitCode } = await runCLI(["install", `file:${fixtureDir("no-manifest")}`], { cwd });
    expect(exitCode).toBe(1);
  }, 15_000);

  test("failed remove exits 1", async () => {
    const cwd = await setup();
    const { exitCode } = await runCLI(["remove", "nonexistent"], { cwd });
    expect(exitCode).toBe(1);
  });
});

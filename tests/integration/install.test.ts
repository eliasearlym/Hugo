import { describe, test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { install } from "../../src/commands/install";
import { createTempDir, readState, fileExists, readFileContent, fixtureDir, getFileMode } from "../helpers";

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

describe("install", () => {
  test("install basic-workflow — files copied, state correct, hashes match", async () => {
    const opencodeDir = await setup();
    const spec = `file:${fixtureDir("basic-workflow")}`;

    const result = await install(opencodeDir, spec);

    expect(result.workflowName).toBe("basic-workflow");
    expect(result.version).toBe("1.0.0");
    expect(result.agents).toBe(1);
    expect(result.skills).toBe(1);
    expect(result.commands).toBe(1);

    // Verify files exist
    expect(await fileExists(join(opencodeDir, "agents/reviewer.md"))).toBe(true);
    expect(await fileExists(join(opencodeDir, "skills/analysis/SKILL.md"))).toBe(true);
    expect(await fileExists(join(opencodeDir, "skills/analysis/scripts/run.sh"))).toBe(true);
    expect(await fileExists(join(opencodeDir, "commands/review.md"))).toBe(true);

    // Verify state.json
    const state = await readState(opencodeDir);
    expect(state).not.toBeNull();
    expect(state!.workflows).toHaveLength(1);

    const entry = state!.workflows[0];
    expect(entry.name).toBe("basic-workflow");
    expect(entry.version).toBe("1.0.0");
    expect(entry.files).toHaveLength(4); // 1 agent + 2 skill files + 1 command

    // Verify hashes are non-empty hex strings
    for (const file of entry.files) {
      expect(file.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 15_000);

  test("install agents-only — only agent files, no skills/commands dirs", async () => {
    const opencodeDir = await setup();
    const spec = `file:${fixtureDir("agents-only")}`;

    const result = await install(opencodeDir, spec);

    expect(result.workflowName).toBe("agents-only");
    expect(result.agents).toBe(2);
    expect(result.skills).toBe(0);
    expect(result.commands).toBe(0);

    expect(await fileExists(join(opencodeDir, "agents/planner.md"))).toBe(true);
    expect(await fileExists(join(opencodeDir, "agents/executor.md"))).toBe(true);
    expect(await fileExists(join(opencodeDir, "skills"))).toBe(false);
    expect(await fileExists(join(opencodeDir, "commands"))).toBe(false);
  }, 15_000);

  test("install empty-workflow — no files copied, state entry exists", async () => {
    const opencodeDir = await setup();
    const spec = `file:${fixtureDir("empty-workflow")}`;

    const result = await install(opencodeDir, spec);

    expect(result.workflowName).toBe("empty-workflow");
    expect(result.agents).toBe(0);
    expect(result.skills).toBe(0);
    expect(result.commands).toBe(0);

    const state = await readState(opencodeDir);
    expect(state!.workflows).toHaveLength(1);
    expect(state!.workflows[0].files).toHaveLength(0);
  }, 15_000);

  test("install no-manifest package — throws clear error", async () => {
    const opencodeDir = await setup();
    const spec = `file:${fixtureDir("no-manifest")}`;

    await expect(install(opencodeDir, spec)).rejects.toThrow("hugo-workflow.json");
  }, 15_000);

  test("install bad-manifest package — throws ManifestError", async () => {
    const opencodeDir = await setup();
    const spec = `file:${fixtureDir("bad-manifest")}`;

    await expect(install(opencodeDir, spec)).rejects.toThrow("name");
  }, 15_000);

  test("install same package twice (clean) — overwrites, updates syncedAt", async () => {
    const opencodeDir = await setup();
    const spec = `file:${fixtureDir("basic-workflow")}`;

    await install(opencodeDir, spec);
    const state1 = await readState(opencodeDir);
    const syncedAt1 = state1!.workflows[0].syncedAt;

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 50));

    await install(opencodeDir, spec);
    const state2 = await readState(opencodeDir);

    expect(state2!.workflows).toHaveLength(1);
    expect(state2!.workflows[0].syncedAt).not.toBe(syncedAt1);
  }, 15_000);

  test("install same package twice (modified file) — skips modified with warning", async () => {
    const opencodeDir = await setup();
    const spec = `file:${fixtureDir("basic-workflow")}`;

    await install(opencodeDir, spec);

    // Modify a file
    const reviewerPath = join(opencodeDir, "agents/reviewer.md");
    await writeFile(reviewerPath, "# Modified by user\n");

    const result = await install(opencodeDir, spec);

    // Should have a warning about the modified file
    expect(result.warnings.some((w) => w.includes("locally modified"))).toBe(true);

    // Modified file should NOT be overwritten
    const content = await readFileContent(reviewerPath);
    expect(content).toBe("# Modified by user\n");
  }, 15_000);

  test("install with unmanaged file conflict — skips with warning", async () => {
    const opencodeDir = await setup();

    // Pre-create a file that will conflict
    await mkdir(join(opencodeDir, "agents"), { recursive: true });
    await writeFile(join(opencodeDir, "agents/reviewer.md"), "# Pre-existing file\n");

    const spec = `file:${fixtureDir("basic-workflow")}`;
    const result = await install(opencodeDir, spec);

    // Should warn about the unmanaged conflict
    expect(result.warnings.some((w) => w.includes("not managed by Hugo"))).toBe(true);

    // File should not be overwritten
    const content = await readFileContent(join(opencodeDir, "agents/reviewer.md"));
    expect(content).toBe("# Pre-existing file\n");
  }, 15_000);

  test("install with force — overwrites unmanaged file conflict", async () => {
    const opencodeDir = await setup();

    // Pre-create a file that will conflict
    await mkdir(join(opencodeDir, "agents"), { recursive: true });
    await writeFile(join(opencodeDir, "agents/reviewer.md"), "# Pre-existing file\n");

    const spec = `file:${fixtureDir("basic-workflow")}`;
    const result = await install(opencodeDir, spec, { force: true });

    // No warnings about unmanaged files
    expect(result.warnings.some((w) => w.includes("not managed by Hugo"))).toBe(false);

    // File should be overwritten with workflow content
    const content = await readFileContent(join(opencodeDir, "agents/reviewer.md"));
    expect(content).toContain("Code Reviewer");
  }, 15_000);

  test("install with force — overwrites locally modified file on reinstall", async () => {
    const opencodeDir = await setup();
    const spec = `file:${fixtureDir("basic-workflow")}`;

    await install(opencodeDir, spec);

    // Modify a file
    const reviewerPath = join(opencodeDir, "agents/reviewer.md");
    await writeFile(reviewerPath, "# Modified by user\n");

    // Reinstall with force
    const result = await install(opencodeDir, spec, { force: true });

    // No warnings about modified files
    expect(result.warnings.some((w) => w.includes("locally modified"))).toBe(false);

    // File should be overwritten with original content
    const content = await readFileContent(reviewerPath);
    expect(content).toContain("Code Reviewer");
  }, 15_000);

  test("install two workflows that conflict — second throws", async () => {
    const opencodeDir = await setup();

    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    await expect(
      install(opencodeDir, `file:${fixtureDir("conflict-workflow")}`)
    ).rejects.toThrow("already exists from workflow");
  }, 15_000);

  test("partial failure cleanup — copied files cleaned up, state clean", async () => {
    const opencodeDir = await setup();
    const spec = `file:${fixtureDir("partial-fail")}`;

    await expect(install(opencodeDir, spec)).rejects.toThrow();

    // first.md should have been cleaned up (it was copied before the error)
    expect(await fileExists(join(opencodeDir, "agents/first.md"))).toBe(false);

    // state.json should not contain the failed workflow
    const state = await readState(opencodeDir);
    if (state) {
      expect(state.workflows.filter((w) => w.name === "partial-fail")).toHaveLength(0);
    }
  }, 15_000);

  test("reinstall after partial failure — clean install succeeds", async () => {
    const opencodeDir = await setup();

    // First: trigger partial failure
    try {
      await install(opencodeDir, `file:${fixtureDir("partial-fail")}`);
    } catch {
      // expected
    }

    // Now install a working package — should succeed without orphan conflicts
    const result = await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);
    expect(result.workflowName).toBe("basic-workflow");
    expect(await fileExists(join(opencodeDir, "agents/reviewer.md"))).toBe(true);
  }, 15_000);

  test("file permissions preserved — run.sh stays executable", async () => {
    const opencodeDir = await setup();
    const spec = `file:${fixtureDir("basic-workflow")}`;

    await install(opencodeDir, spec);

    const destPath = join(opencodeDir, "skills/analysis/scripts/run.sh");
    const mode = await getFileMode(destPath);

    // Check that owner execute bit is set (0o100)
    expect(mode & 0o100).toBe(0o100);
  }, 15_000);
});

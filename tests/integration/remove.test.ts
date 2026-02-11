import { describe, test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { writeFile, rm, readdir } from "node:fs/promises";
import { install } from "../../src/commands/install";
import { remove } from "../../src/commands/remove";
import {
  createTempDir,
  readState,
  fileExists,
  readFileContent,
  fixtureDir,
} from "../helpers";

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

describe("remove", () => {
  test("removes installed workflow — files deleted, state entry gone, no empty dirs", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    const result = await remove(opencodeDir, "basic-workflow");

    expect(result.name).toBe("basic-workflow");
    expect(result.removed).toBeGreaterThan(0);
    expect(result.kept).toBe(0);
    expect(result.keptFiles).toHaveLength(0);

    // All files should be deleted
    expect(await fileExists(join(opencodeDir, "agents/reviewer.md"))).toBe(false);
    expect(await fileExists(join(opencodeDir, "commands/review.md"))).toBe(false);
    expect(await fileExists(join(opencodeDir, "skills/analysis/SKILL.md"))).toBe(false);
    expect(await fileExists(join(opencodeDir, "skills/analysis/scripts/run.sh"))).toBe(false);

    // State should have no workflows
    const state = await readState(opencodeDir);
    expect(state!.workflows).toHaveLength(0);

    // No empty skill dirs should remain
    expect(await fileExists(join(opencodeDir, "skills/analysis"))).toBe(false);
  }, 15_000);

  test("removes with locally modified file — modified file kept, others deleted", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    // Modify agents/reviewer.md
    const reviewerPath = join(opencodeDir, "agents/reviewer.md");
    await writeFile(reviewerPath, "# My custom changes\n");

    const result = await remove(opencodeDir, "basic-workflow");

    expect(result.kept).toBe(1);
    expect(result.keptFiles).toContain("agents/reviewer.md");

    // Modified file should still exist
    expect(await fileExists(reviewerPath)).toBe(true);
    const content = await readFileContent(reviewerPath);
    expect(content).toBe("# My custom changes\n");

    // Other files should be deleted
    expect(await fileExists(join(opencodeDir, "commands/review.md"))).toBe(false);
    expect(await fileExists(join(opencodeDir, "skills/analysis/SKILL.md"))).toBe(false);

    // State entry should be removed
    const state = await readState(opencodeDir);
    expect(state!.workflows).toHaveLength(0);
  }, 15_000);

  test("removes with all files modified — all files kept, state entry removed", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    // Modify ALL files
    await writeFile(join(opencodeDir, "agents/reviewer.md"), "# Modified\n");
    await writeFile(join(opencodeDir, "commands/review.md"), "# Modified\n");
    await writeFile(join(opencodeDir, "skills/analysis/SKILL.md"), "# Modified\n");
    await writeFile(join(opencodeDir, "skills/analysis/scripts/run.sh"), "#!/bin/bash\n# Modified\n");

    const result = await remove(opencodeDir, "basic-workflow");

    expect(result.kept).toBe(4);
    expect(result.keptFiles).toHaveLength(4);
    expect(result.removed).toBe(0);

    // All files should still exist
    expect(await fileExists(join(opencodeDir, "agents/reviewer.md"))).toBe(true);
    expect(await fileExists(join(opencodeDir, "commands/review.md"))).toBe(true);
    expect(await fileExists(join(opencodeDir, "skills/analysis/SKILL.md"))).toBe(true);
    expect(await fileExists(join(opencodeDir, "skills/analysis/scripts/run.sh"))).toBe(true);

    // State entry should still be removed
    const state = await readState(opencodeDir);
    expect(state!.workflows).toHaveLength(0);
  }, 15_000);

  test("removes with already-deleted file — no error, counts as removed", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    // Manually delete a file
    await rm(join(opencodeDir, "commands/review.md"));

    const result = await remove(opencodeDir, "basic-workflow");

    // Should not throw, and the deleted file counts as removed
    expect(result.removed).toBeGreaterThan(0);
    expect(result.kept).toBe(0);

    // State entry should be removed
    const state = await readState(opencodeDir);
    expect(state!.workflows).toHaveLength(0);
  }, 15_000);

  test("removes non-existent workflow — throws 'not installed'", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    await expect(remove(opencodeDir, "nonexistent")).rejects.toThrow("not installed");
  }, 15_000);
});

import { describe, test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { writeFile, rm, readdir, mkdir } from "node:fs/promises";
import { install } from "../../src/commands/install";
import { update } from "../../src/commands/update";
import { readWorkflowState, writeWorkflowState } from "../../src/workflows/state";
import {
  createTempDir,
  readState,
  fileExists,
  readFileContent,
  stageFixture,
  swapFixtureVersion,
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

/**
 * Stage basic-workflow, install it, then swap to v2 for update tests.
 * Returns the opencodeDir and stagingDir for further assertions.
 */
async function installAndStageV2() {
  const opencodeDir = await setup();
  const { dir: stagingDir, spec, cleanup: stagingCleanup } = await stageFixture("basic-workflow");
  cleanups.push(stagingCleanup);

  await install(opencodeDir, spec);
  await swapFixtureVersion(stagingDir, "basic-workflow-v2");

  return { opencodeDir, stagingDir, spec };
}

describe("update", () => {
  test("detects version change — updated files overwritten, new files added, removed files deleted, state reflects v2", async () => {
    const { opencodeDir } = await installAndStageV2();

    const result = await update(opencodeDir);

    expect(result.workflows).toHaveLength(1);
    const wf = result.workflows[0];
    expect(wf.oldVersion).toBe("1.0.0");
    expect(wf.newVersion).toBe("2.0.0");

    // reviewer.md was updated (content changed in v2)
    expect(wf.updated).toContain("agents/reviewer.md");

    // commands/lint.md is new in v2
    expect(wf.added).toContain("commands/lint.md");

    // skills/analysis/helpers/format.sh is new in v2
    expect(wf.added).toContain("skills/analysis/helpers/format.sh");

    // commands/review.md was in v1 but not v2 — should be removed
    expect(wf.removed).toContain("commands/review.md");
    expect(await fileExists(join(opencodeDir, "commands/review.md"))).toBe(false);

    // Updated files exist with new content
    const reviewerContent = await readFileContent(join(opencodeDir, "agents/reviewer.md"));
    expect(reviewerContent).toContain("v2");

    // State reflects v2
    const state = await readState(opencodeDir);
    expect(state!.workflows[0].version).toBe("2.0.0");
  }, 15_000);

  test("with no version change — reports already up to date", async () => {
    const opencodeDir = await setup();
    const { spec, cleanup: stagingCleanup } = await stageFixture("basic-workflow");
    cleanups.push(stagingCleanup);

    await install(opencodeDir, spec);

    // Don't swap to v2 — version stays the same
    const result = await update(opencodeDir);

    expect(result.unchanged).toContain("basic-workflow");
    expect(result.workflows).toHaveLength(0);
  }, 15_000);

  test("skips locally modified files", async () => {
    const { opencodeDir } = await installAndStageV2();

    // Modify agents/reviewer.md before update
    const reviewerPath = join(opencodeDir, "agents/reviewer.md");
    await writeFile(reviewerPath, "# My custom changes\n");

    const result = await update(opencodeDir);

    const wf = result.workflows[0];
    expect(wf.skipped.some((s) => s.path === "agents/reviewer.md" && s.reason.includes("locally modified"))).toBe(true);

    // File should retain user's modifications
    const content = await readFileContent(reviewerPath);
    expect(content).toBe("# My custom changes\n");
  }, 15_000);

  test("skips locally deleted files", async () => {
    const { opencodeDir } = await installAndStageV2();

    // Delete agents/reviewer.md before update
    await rm(join(opencodeDir, "agents/reviewer.md"));

    const result = await update(opencodeDir);

    const wf = result.workflows[0];
    expect(wf.skipped.some((s) => s.path === "agents/reviewer.md" && s.reason.includes("locally deleted"))).toBe(true);

    // File should still not exist (not re-created)
    expect(await fileExists(join(opencodeDir, "agents/reviewer.md"))).toBe(false);
  }, 15_000);

  test("removes files dropped from manifest", async () => {
    const { opencodeDir } = await installAndStageV2();

    // commands/review.md is in v1 but not v2
    // Verify it existed before update
    expect(await fileExists(join(opencodeDir, "commands/review.md"))).toBe(true);

    const result = await update(opencodeDir);

    expect(result.workflows[0].removed).toContain("commands/review.md");
    expect(await fileExists(join(opencodeDir, "commands/review.md"))).toBe(false);
  }, 15_000);

  test("keeps modified file removed from manifest", async () => {
    const { opencodeDir } = await installAndStageV2();

    // Modify commands/review.md (in v1 manifest, not in v2)
    const reviewPath = join(opencodeDir, "commands/review.md");
    await writeFile(reviewPath, "# My custom review command\n");

    const result = await update(opencodeDir);

    const wf = result.workflows[0];
    // Should be skipped because it's locally modified even though removed from manifest
    expect(wf.skipped.some((s) => s.path === "commands/review.md" && s.reason.includes("locally modified"))).toBe(true);

    // File should still exist
    expect(await fileExists(reviewPath)).toBe(true);
    const content = await readFileContent(reviewPath);
    expect(content).toBe("# My custom review command\n");
  }, 15_000);

  test("adds new files from v2", async () => {
    const { opencodeDir } = await installAndStageV2();

    // Before update, new files should not exist
    expect(await fileExists(join(opencodeDir, "commands/lint.md"))).toBe(false);
    expect(await fileExists(join(opencodeDir, "skills/analysis/helpers/format.sh"))).toBe(false);

    await update(opencodeDir);

    // After update, new files should exist
    expect(await fileExists(join(opencodeDir, "commands/lint.md"))).toBe(true);
    expect(await fileExists(join(opencodeDir, "skills/analysis/helpers/format.sh"))).toBe(true);

    const lintContent = await readFileContent(join(opencodeDir, "commands/lint.md"));
    expect(lintContent).toContain("Lint Command");
  }, 15_000);

  test("cleans empty skill dirs after update", async () => {
    const { opencodeDir } = await installAndStageV2();

    await update(opencodeDir);

    // After v1→v2 update, verify no empty dirs exist under skills/
    const skillsDir = join(opencodeDir, "skills");
    if (await fileExists(skillsDir)) {
      const hasEmptyDir = await checkForEmptyDirs(skillsDir);
      expect(hasEmptyDir).toBe(false);
    }
  }, 15_000);

  test("update idempotency — second run reports unchanged", async () => {
    const { opencodeDir } = await installAndStageV2();

    // First update
    const result1 = await update(opencodeDir);
    expect(result1.workflows).toHaveLength(1);

    const stateAfterFirst = await readState(opencodeDir);

    // Second update — should be a no-op
    const result2 = await update(opencodeDir);
    expect(result2.unchanged).toContain("basic-workflow");
    expect(result2.workflows).toHaveLength(0);

    // State should be identical (except possibly syncedAt won't change since no update happened)
    const stateAfterSecond = await readState(opencodeDir);
    expect(stateAfterSecond!.workflows[0].version).toBe(stateAfterFirst!.workflows[0].version);
    expect(stateAfterSecond!.workflows[0].files).toEqual(stateAfterFirst!.workflows[0].files);
  }, 15_000);

  test("skips new file that conflicts with unmanaged file on disk", async () => {
    const { opencodeDir } = await installAndStageV2();

    // Create an unmanaged file at the destination v2 will try to add
    const lintPath = join(opencodeDir, "commands/lint.md");
    await writeFile(lintPath, "# My own lint command\n");

    const result = await update(opencodeDir);

    const wf = result.workflows[0];
    // Should be skipped, not added
    expect(wf.added).not.toContain("commands/lint.md");
    expect(wf.skipped.some((s) => s.path === "commands/lint.md" && s.reason.includes("not managed by Hugo"))).toBe(true);

    // User's file should be preserved
    const content = await readFileContent(lintPath);
    expect(content).toBe("# My own lint command\n");

    // State should NOT include the skipped file
    const state = await readState(opencodeDir);
    const wfState = state!.workflows.find((w) => w.name === "basic-workflow");
    expect(wfState!.files.some((f) => f.destination === "commands/lint.md")).toBe(false);
  }, 15_000);

  test("throws when new file conflicts with another workflow's file", async () => {
    const { opencodeDir } = await installAndStageV2();

    // Manually create a file at commands/lint.md owned by a fake workflow
    const lintPath = join(opencodeDir, "commands/lint.md");
    await writeFile(lintPath, "# Owned by other workflow\n");

    // Add a fake workflow entry to state that owns this file
    const state = await readWorkflowState(opencodeDir);
    state.workflows.push({
      name: "other-workflow",
      package: "other-workflow",
      source: { type: "registry", name: "other-workflow" },
      version: "1.0.0",
      syncedAt: new Date().toISOString(),
      files: [{ source: "commands/lint.md", destination: "commands/lint.md", hash: "fakehash" }],
    });
    await writeWorkflowState(opencodeDir, state);

    await expect(update(opencodeDir)).rejects.toThrow(
      'File "commands/lint.md" already exists from workflow "other-workflow"',
    );
  }, 15_000);

  test("with nothing installed — throws 'No workflows installed'", async () => {
    const opencodeDir = await setup();

    await expect(update(opencodeDir)).rejects.toThrow("No workflows installed");
  }, 15_000);
});

/**
 * Recursively check if any directory under the given path is empty.
 */
async function checkForEmptyDirs(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.length === 0) return true;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const isEmpty = await checkForEmptyDirs(join(dir, entry.name));
      if (isEmpty) return true;
    }
  }
  return false;
}

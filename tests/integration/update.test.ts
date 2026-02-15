import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { writeFile, rm, readFile } from "node:fs/promises";
import { createTempDir, stageFixture, swapFixtureVersion, fileExists } from "../helpers";
import { install } from "../../src/commands/install";
import { update } from "../../src/commands/update";

let projectDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: projectDir, cleanup } = await createTempDir());
});

afterEach(async () => {
  await cleanup();
});

describe("update", () => {
  test("update with no changes reports up to date", async () => {
    // Use staged fixture so bun add doesn't touch shared fixtures
    const staged = await stageFixture("basic-workflow");
    try {
      await install({ projectDir, spec: staged.spec });
      const result = await update({ projectDir, name: "basic-workflow" });

      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0].updated).toBe(false);
      expect(result.workflows[0].workflowName).toBe("basic-workflow");
      expect(result.workflows[0].warnings).toEqual([]);
    } finally {
      await staged.cleanup();
    }
  });

  test("single-target update throws when workflow.json is corrupt after update", async () => {
    const staged = await stageFixture("basic-workflow");
    try {
      await install({ projectDir, spec: staged.spec });

      // Corrupt the workflow.json in the staged source.
      // bun file: installs reference the source, so the installed copy
      // in node_modules will see the corrupt file on next read.
      await writeFile(join(staged.dir, "workflow.json"), "{{corrupt json");

      await expect(
        update({ projectDir, name: "basic-workflow" }),
      ).rejects.toThrow("could not read workflow.json");
    } finally {
      await staged.cleanup();
    }
  });

  test("single-target update throws when workflow.json is missing after update", async () => {
    const staged = await stageFixture("basic-workflow");
    try {
      await install({ projectDir, spec: staged.spec });

      // Remove the workflow.json from the staged source
      await rm(join(staged.dir, "workflow.json"));

      await expect(
        update({ projectDir, name: "basic-workflow" }),
      ).rejects.toThrow("could not read workflow.json");
    } finally {
      await staged.cleanup();
    }
  });

  test("bulk update warns instead of throwing when workflow.json is corrupt", async () => {
    const staged = await stageFixture("basic-workflow");
    try {
      await install({ projectDir, spec: staged.spec });

      await writeFile(join(staged.dir, "workflow.json"), "{{corrupt json");

      // Bulk update (no name) should warn and fall back to cached data
      const result = await update({ projectDir });

      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0].warnings.length).toBeGreaterThan(0);
      expect(result.workflows[0].warnings[0]).toContain(
        "Could not read workflow.json after update",
      );
      // Falls back to cached data — no structural changes detected
      expect(result.workflows[0].addedAgents).toEqual([]);
      expect(result.workflows[0].removedAgents).toEqual([]);
    } finally {
      await staged.cleanup();
    }
  });

  test("detects version bump and manifest changes after update", async () => {
    // Install v1: version 1.0.0, commands: ["review"]
    const staged = await stageFixture("basic-workflow");
    try {
      await install({ projectDir, spec: staged.spec });

      // Swap to v2: version 2.0.0, commands: ["lint"] (review removed, lint added)
      await swapFixtureVersion(staged.dir, "basic-workflow-v2");

      const result = await update({ projectDir, name: "basic-workflow" });

      expect(result.workflows).toHaveLength(1);
      const w = result.workflows[0];
      expect(w.updated).toBe(true);
      expect(w.oldVersion).toBe("1.0.0");
      expect(w.newVersion).toBe("2.0.0");

      // Structural changes: "review" removed, "lint" added
      expect(w.addedCommands).toEqual(["lint"]);
      expect(w.removedCommands).toEqual(["review"]);

      // Agents, skills, and mcps unchanged
      expect(w.addedAgents).toEqual([]);
      expect(w.removedAgents).toEqual([]);
      expect(w.addedSkills).toEqual([]);
      expect(w.removedSkills).toEqual([]);
      expect(w.addedMcps).toEqual([]);
      expect(w.removedMcps).toEqual([]);
      expect(w.warnings).toEqual([]);
    } finally {
      await staged.cleanup();
    }
  });

  // -----------------------------------------------------------------------
  // Skill syncing on update
  // -----------------------------------------------------------------------

  test("resyncs skill files on version bump", async () => {
    // Install v1: has skills/analysis/ with "Running analysis..."
    const staged = await stageFixture("basic-workflow");
    try {
      await install({ projectDir, spec: staged.spec });

      const skillFile = join(
        projectDir,
        ".opencode",
        "skills",
        "analysis",
        "scripts",
        "run.sh",
      );
      const v1Content = await readFile(skillFile, "utf-8");
      expect(v1Content).toContain("Running analysis...");

      // Swap to v2: has skills/analysis/ with "Running analysis v2..."
      await swapFixtureVersion(staged.dir, "basic-workflow-v2");

      await update({ projectDir, name: "basic-workflow" });

      // Skill file should now have v2 content
      const v2Content = await readFile(skillFile, "utf-8");
      expect(v2Content).toContain("Running analysis v2...");
    } finally {
      await staged.cleanup();
    }
  });

  test("copies new subdirectories added in updated skill", async () => {
    // v1 has skills/analysis/scripts/run.sh
    // v2 adds skills/analysis/helpers/format.sh
    const staged = await stageFixture("basic-workflow");
    try {
      await install({ projectDir, spec: staged.spec });

      const helpersDir = join(
        projectDir,
        ".opencode",
        "skills",
        "analysis",
        "helpers",
      );
      expect(await fileExists(helpersDir)).toBe(false);

      await swapFixtureVersion(staged.dir, "basic-workflow-v2");
      await update({ projectDir, name: "basic-workflow" });

      expect(await fileExists(helpersDir)).toBe(true);
      expect(
        await fileExists(join(helpersDir, "format.sh")),
      ).toBe(true);
    } finally {
      await staged.cleanup();
    }
  });

  test("errors when workflow not installed", async () => {
    await expect(
      update({ projectDir, name: "nonexistent" }),
    ).rejects.toThrow('Workflow "nonexistent" is not installed.');
  });

  test("errors when no workflows installed", async () => {
    await expect(update({ projectDir })).rejects.toThrow(
      "No workflows installed.",
    );
  });
});

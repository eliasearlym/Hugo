import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { writeFile, rm } from "node:fs/promises";
import { createTempDir, stageFixture, swapFixtureVersion } from "../helpers";
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

  test("warnings field populated when workflow.json is corrupt after update", async () => {
    const staged = await stageFixture("basic-workflow");
    try {
      await install({ projectDir, spec: staged.spec });

      // Corrupt the workflow.json in the staged source.
      // bun file: installs reference the source, so the installed copy
      // in node_modules will see the corrupt file on next read.
      await writeFile(join(staged.dir, "workflow.json"), "{{corrupt json");

      const result = await update({ projectDir, name: "basic-workflow" });

      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0].warnings.length).toBeGreaterThan(0);
      expect(result.workflows[0].warnings[0]).toContain(
        "Could not read workflow.json after update",
      );
    } finally {
      await staged.cleanup();
    }
  });

  test("warnings field populated when workflow.json is missing after update", async () => {
    const staged = await stageFixture("basic-workflow");
    try {
      await install({ projectDir, spec: staged.spec });

      // Remove the workflow.json from the staged source
      await rm(join(staged.dir, "workflow.json"));

      const result = await update({ projectDir, name: "basic-workflow" });

      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0].warnings.length).toBeGreaterThan(0);
      expect(result.workflows[0].warnings[0]).toContain(
        "Could not read workflow.json after update",
      );
      // Should fall back to cached data — no structural changes detected
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

      // Agents and skills unchanged
      expect(w.addedAgents).toEqual([]);
      expect(w.removedAgents).toEqual([]);
      expect(w.addedSkills).toEqual([]);
      expect(w.removedSkills).toEqual([]);
      expect(w.warnings).toEqual([]);
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

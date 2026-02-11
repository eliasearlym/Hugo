import { describe, test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { writeFile, rm } from "node:fs/promises";
import { install } from "../../src/commands/install";
import { status } from "../../src/commands/status";
import { createTempDir, fixtureDir } from "../helpers";

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

describe("status", () => {
  test("clean install — all files clean", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    const result = await status(opencodeDir);

    expect(result.workflows).toHaveLength(1);
    const wf = result.workflows[0];
    expect(wf.name).toBe("basic-workflow");
    expect(wf.version).toBe("1.0.0");

    for (const file of wf.files) {
      expect(file.status).toBe("clean");
    }
  }, 15_000);

  test("after modifying a file — that file modified, others clean", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    // Modify one file
    await writeFile(join(opencodeDir, "agents/reviewer.md"), "# Changed\n");

    const result = await status(opencodeDir);

    const wf = result.workflows[0];
    const reviewerStatus = wf.files.find((f) => f.file.destination === "agents/reviewer.md");
    expect(reviewerStatus).toBeDefined();
    expect(reviewerStatus!.status).toBe("modified");

    // All other files should be clean
    const otherFiles = wf.files.filter((f) => f.file.destination !== "agents/reviewer.md");
    for (const file of otherFiles) {
      expect(file.status).toBe("clean");
    }
  }, 15_000);

  test("after deleting a file — that file deleted, others clean", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    // Delete one file
    await rm(join(opencodeDir, "agents/reviewer.md"));

    const result = await status(opencodeDir);

    const wf = result.workflows[0];
    const reviewerStatus = wf.files.find((f) => f.file.destination === "agents/reviewer.md");
    expect(reviewerStatus).toBeDefined();
    expect(reviewerStatus!.status).toBe("deleted");

    // All other files should be clean
    const otherFiles = wf.files.filter((f) => f.file.destination !== "agents/reviewer.md");
    for (const file of otherFiles) {
      expect(file.status).toBe("clean");
    }
  }, 15_000);

  test("for specific workflow name — only that workflow reported", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);
    await install(opencodeDir, `file:${fixtureDir("agents-only")}`);

    const result = await status(opencodeDir, "basic-workflow");

    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].name).toBe("basic-workflow");
  }, 15_000);

  test("for non-existent name — throws error", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    await expect(status(opencodeDir, "nonexistent")).rejects.toThrow("not installed");
  }, 15_000);
});

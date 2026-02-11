import { describe, test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { writeFile, rm } from "node:fs/promises";
import { install } from "../../src/commands/install";
import { checkIntegrity } from "../../src/workflows/integrity";
import { createTempDir, readState, fixtureDir } from "../helpers";

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

describe("checkIntegrity", () => {
  test("all files unchanged — all clean", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    const state = await readState(opencodeDir);
    const entry = state!.workflows[0];

    const statuses = await checkIntegrity(opencodeDir, entry);

    expect(statuses.length).toBe(entry.files.length);
    for (const fs of statuses) {
      expect(fs.status).toBe("clean");
    }
  }, 15_000);

  test("one file modified — that file modified, others clean", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    // Modify one file
    await writeFile(join(opencodeDir, "agents/reviewer.md"), "# Changed content\n");

    const state = await readState(opencodeDir);
    const entry = state!.workflows[0];

    const statuses = await checkIntegrity(opencodeDir, entry);

    const modified = statuses.find((s) => s.file.destination === "agents/reviewer.md");
    expect(modified).toBeDefined();
    expect(modified!.status).toBe("modified");

    const clean = statuses.filter((s) => s.file.destination !== "agents/reviewer.md");
    for (const fs of clean) {
      expect(fs.status).toBe("clean");
    }
  }, 15_000);

  test("one file deleted — that file deleted, others clean", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    // Delete one file
    await rm(join(opencodeDir, "agents/reviewer.md"));

    const state = await readState(opencodeDir);
    const entry = state!.workflows[0];

    const statuses = await checkIntegrity(opencodeDir, entry);

    const deleted = statuses.find((s) => s.file.destination === "agents/reviewer.md");
    expect(deleted).toBeDefined();
    expect(deleted!.status).toBe("deleted");

    const clean = statuses.filter((s) => s.file.destination !== "agents/reviewer.md");
    for (const fs of clean) {
      expect(fs.status).toBe("clean");
    }
  }, 15_000);

  test("all files deleted — all deleted", async () => {
    const opencodeDir = await setup();
    await install(opencodeDir, `file:${fixtureDir("basic-workflow")}`);

    const state = await readState(opencodeDir);
    const entry = state!.workflows[0];

    // Delete all files
    for (const file of entry.files) {
      await rm(join(opencodeDir, file.destination));
    }

    const statuses = await checkIntegrity(opencodeDir, entry);

    expect(statuses.length).toBe(entry.files.length);
    for (const fs of statuses) {
      expect(fs.status).toBe("deleted");
    }
  }, 15_000);
});

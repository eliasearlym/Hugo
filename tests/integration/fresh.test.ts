import { describe, test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { install } from "../../src/commands/install";
import { update } from "../../src/commands/update";
import { remove } from "../../src/commands/remove";
import { status } from "../../src/commands/status";
import { list } from "../../src/commands/list";
import { createTempDir, readState, fileExists, fixtureDir } from "../helpers";

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

describe("fresh project (no .opencode dir)", () => {
  test("list() with no .opencode dir — returns empty workflows list", async () => {
    const opencodeDir = join(await setup(), ".opencode");
    // opencodeDir does not exist

    const result = await list(opencodeDir);

    expect(result.workflows).toHaveLength(0);
  });

  test("status() with no .opencode dir — returns empty workflows list", async () => {
    const opencodeDir = join(await setup(), ".opencode");

    const result = await status(opencodeDir);

    expect(result.workflows).toHaveLength(0);
  });

  test("update() with no .opencode dir — throws 'No workflows installed'", async () => {
    const opencodeDir = join(await setup(), ".opencode");

    await expect(update(opencodeDir)).rejects.toThrow("No workflows installed");
  });

  test("remove() with no .opencode dir — throws 'not installed'", async () => {
    const opencodeDir = join(await setup(), ".opencode");

    await expect(remove(opencodeDir, "anything")).rejects.toThrow("not installed");
  });

  test("install() with no .opencode dir — creates dir, installs successfully", async () => {
    const opencodeDir = join(await setup(), ".opencode");
    const spec = `file:${fixtureDir("basic-workflow")}`;

    // opencodeDir does not exist yet — install should create it
    const result = await install(opencodeDir, spec);

    expect(result.workflowName).toBe("basic-workflow");
    expect(result.version).toBe("1.0.0");

    // Verify the dir was created and files were installed
    expect(await fileExists(join(opencodeDir, "agents/reviewer.md"))).toBe(true);
    expect(await fileExists(join(opencodeDir, "state.json"))).toBe(true);

    // State should be valid
    const state = await readState(opencodeDir);
    expect(state).not.toBeNull();
    expect(state!.workflows).toHaveLength(1);
    expect(state!.workflows[0].name).toBe("basic-workflow");
  }, 15_000);
});

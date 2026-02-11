import { describe, test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import {
  readWorkflowState,
  writeWorkflowState,
  StateError,
} from "../../src/workflows/state";
import { STATE_FILE } from "../../src/workflows/constants";
import type { WorkflowState } from "../../src/workflows/types";
import { createTempDir } from "../helpers";

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

const VALID_STATE: WorkflowState = {
  workflows: [
    {
      name: "test-workflow",
      package: "test-package",
      source: { type: "registry", name: "test-package" },
      version: "1.0.0",
      syncedAt: "2025-01-01T00:00:00.000Z",
      files: [
        {
          source: "agents/helper.md",
          destination: "agents/helper.md",
          hash: "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
        },
      ],
    },
  ],
};

describe("state (filesystem)", () => {
  test("read from non-existent file — returns { workflows: [] }", async () => {
    const opencodeDir = await setup();

    const state = await readWorkflowState(opencodeDir);

    expect(state).toEqual({ workflows: [] });
  });

  test("write then read round-trip — values match exactly", async () => {
    const opencodeDir = await setup();
    await mkdir(opencodeDir, { recursive: true });

    await writeWorkflowState(opencodeDir, VALID_STATE);
    const readBack = await readWorkflowState(opencodeDir);

    expect(readBack.workflows).toHaveLength(1);
    const entry = readBack.workflows[0];
    expect(entry.name).toBe("test-workflow");
    expect(entry.package).toBe("test-package");
    expect(entry.source).toEqual({ type: "registry", name: "test-package" });
    expect(entry.version).toBe("1.0.0");
    expect(entry.syncedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(entry.files).toHaveLength(1);
    expect(entry.files[0].source).toBe("agents/helper.md");
    expect(entry.files[0].destination).toBe("agents/helper.md");
    expect(entry.files[0].hash).toBe(
      "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
    );
  });

  test("read corrupted JSON — throws StateError", async () => {
    const opencodeDir = await setup();
    await mkdir(opencodeDir, { recursive: true });

    const statePath = join(opencodeDir, STATE_FILE);
    await writeFile(statePath, "this is not json {{{");

    await expect(readWorkflowState(opencodeDir)).rejects.toThrow(StateError);
  });

  test("read valid JSON missing workflows key — throws StateError", async () => {
    const opencodeDir = await setup();
    await mkdir(opencodeDir, { recursive: true });

    const statePath = join(opencodeDir, STATE_FILE);
    await writeFile(statePath, JSON.stringify({ version: 1 }));

    await expect(readWorkflowState(opencodeDir)).rejects.toThrow(StateError);
    await expect(readWorkflowState(opencodeDir)).rejects.toThrow("workflows");
  });

  test("read state with extra unknown fields — succeeds, extra fields ignored", async () => {
    const opencodeDir = await setup();
    await mkdir(opencodeDir, { recursive: true });

    const stateWithExtras = {
      ...VALID_STATE,
      extraTopLevel: "should be ignored",
      workflows: VALID_STATE.workflows.map((w) => ({
        ...w,
        extraField: "also ignored",
        files: w.files.map((f) => ({
          ...f,
          extraFileField: true,
        })),
      })),
    };

    const statePath = join(opencodeDir, STATE_FILE);
    await writeFile(statePath, JSON.stringify(stateWithExtras, null, 2));

    const readBack = await readWorkflowState(opencodeDir);

    // Should succeed and return a valid state
    expect(readBack.workflows).toHaveLength(1);
    expect(readBack.workflows[0].name).toBe("test-workflow");
    expect(readBack.workflows[0].files).toHaveLength(1);

    // Extra fields should be stripped (not present in the typed result)
    expect((readBack as Record<string, unknown>)["extraTopLevel"]).toBeUndefined();
    expect((readBack.workflows[0] as Record<string, unknown>)["extraField"]).toBeUndefined();
  });
});

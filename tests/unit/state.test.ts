import { describe, test, expect } from "bun:test";
import { addEntry, removeEntry, findFileOwner, sourceEquals } from "../../src/workflows/state";
import type { WorkflowState, WorkflowEntry } from "../../src/workflows/types";

function makeEntry(overrides: Partial<WorkflowEntry> = {}): WorkflowEntry {
  return {
    name: "test-workflow",
    package: "test-workflow",
    source: { type: "registry", name: "test-workflow" },
    version: "1.0.0",
    syncedAt: "2025-01-01T00:00:00.000Z",
    files: [],
    ...overrides,
  };
}

describe("addEntry", () => {
  test("adding to empty state results in one entry", () => {
    const state: WorkflowState = { workflows: [] };
    const entry = makeEntry();

    const result = addEntry(state, entry);

    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].name).toBe("test-workflow");
  });

  test("adding entry with same name replaces existing", () => {
    const state: WorkflowState = {
      workflows: [makeEntry({ version: "1.0.0" })],
    };
    const updated = makeEntry({ version: "2.0.0" });

    const result = addEntry(state, updated);

    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].version).toBe("2.0.0");
  });

  test("adding entry with same source but different name replaces existing (dedup by source)", () => {
    const state: WorkflowState = {
      workflows: [makeEntry({ name: "old-name", source: { type: "registry", name: "shared-pkg" } })],
    };
    const entry = makeEntry({ name: "new-name", source: { type: "registry", name: "shared-pkg" } });

    const result = addEntry(state, entry);

    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].name).toBe("new-name");
  });
});

describe("removeEntry", () => {
  test("removes the entry with matching name", () => {
    const state: WorkflowState = {
      workflows: [makeEntry({ name: "to-remove" }), makeEntry({ name: "to-keep", source: { type: "registry", name: "other-pkg" } })],
    };

    const result = removeEntry(state, "to-remove");

    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].name).toBe("to-keep");
  });

  test("removing non-existent name is a no-op", () => {
    const state: WorkflowState = {
      workflows: [makeEntry()],
    };

    const result = removeEntry(state, "does-not-exist");

    expect(result.workflows).toHaveLength(1);
  });
});

describe("findFileOwner", () => {
  test("returns the entry that owns the file", () => {
    const entry = makeEntry({
      files: [
        { source: "agents/helper.md", destination: ".opencode/agents/helper.md", hash: "abc123" },
      ],
    });
    const state: WorkflowState = { workflows: [entry] };

    const owner = findFileOwner(state, ".opencode/agents/helper.md");

    expect(owner).not.toBeNull();
    expect(owner!.name).toBe("test-workflow");
  });

  test("returns null for untracked path", () => {
    const state: WorkflowState = {
      workflows: [makeEntry({ files: [] })],
    };

    const owner = findFileOwner(state, "unknown/path.md");

    expect(owner).toBeNull();
  });
});

describe("sourceEquals", () => {
  test("registry sources with same name are equal", () => {
    expect(
      sourceEquals({ type: "registry", name: "pkg" }, { type: "registry", name: "pkg" }),
    ).toBe(true);
  });

  test("registry sources with same name but different versions are equal", () => {
    expect(
      sourceEquals({ type: "registry", name: "pkg@^1.0.0" }, { type: "registry", name: "pkg@^2.0.0" }),
    ).toBe(true);
  });

  test("registry sources with different names are not equal", () => {
    expect(
      sourceEquals({ type: "registry", name: "pkg-a" }, { type: "registry", name: "pkg-b" }),
    ).toBe(false);
  });

  test("git sources with same URL are equal", () => {
    expect(
      sourceEquals({ type: "git", url: "github:org/repo" }, { type: "git", url: "github:org/repo" }),
    ).toBe(true);
  });

  test("git sources with different URLs are not equal", () => {
    expect(
      sourceEquals({ type: "git", url: "github:org/repo-a" }, { type: "git", url: "github:org/repo-b" }),
    ).toBe(false);
  });

  test("registry vs git source are not equal", () => {
    expect(
      sourceEquals({ type: "registry", name: "pkg" }, { type: "git", url: "github:org/pkg" }),
    ).toBe(false);
  });
});

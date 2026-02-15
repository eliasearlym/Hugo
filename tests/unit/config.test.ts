import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createTempDir } from "../helpers";
import {
  readConfig,
  writeConfig,
  getPlugins,
  hasPlugin,
  addPlugin,
  removePlugin,
  getWorkflows,
  getWorkflow,
  setWorkflow,
  removeWorkflow,
  resolveWorkflowTargets,
} from "../../src/workflows/config";
import type { WorkflowEntry } from "../../src/workflows/types";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await createTempDir());
});

afterEach(async () => {
  await cleanup();
});

const sampleEntry: WorkflowEntry = {
  package: "@org/code-review",
  version: "1.0.0",
  agents: ["reviewer"],
  commands: ["review"],
  skills: ["analysis"],
  mcps: [],
};

// ---------------------------------------------------------------------------
// readConfig / writeConfig
// ---------------------------------------------------------------------------

describe("readConfig", () => {
  test("returns {} when file does not exist", async () => {
    const config = await readConfig(dir);
    expect(config).toEqual({});
  });

  test("reads valid JSON", async () => {
    await writeFile(
      join(dir, "opencode.json"),
      JSON.stringify({ plugin: ["a"], theme: "dark" }, null, 2),
    );
    const config = await readConfig(dir);
    expect(config).toEqual({ plugin: ["a"], theme: "dark" });
  });

  test("reads JSONC (comments)", async () => {
    await writeFile(
      join(dir, "opencode.json"),
      `{
  // this is a comment
  "plugin": ["a"],
  /* block comment */
  "theme": "dark"
}`,
    );
    const config = await readConfig(dir);
    expect(config).toEqual({ plugin: ["a"], theme: "dark" });
  });

  test("throws on invalid JSONC", async () => {
    await writeFile(join(dir, "opencode.json"), "{ not valid json!!");
    await expect(readConfig(dir)).rejects.toThrow();
  });

  test("throws when file is not an object", async () => {
    await writeFile(join(dir, "opencode.json"), '"just a string"');
    await expect(readConfig(dir)).rejects.toThrow("must contain a JSON object");
  });

  test("throws when file is an array", async () => {
    await writeFile(join(dir, "opencode.json"), "[1, 2, 3]");
    await expect(readConfig(dir)).rejects.toThrow("must contain a JSON object");
  });
});

describe("writeConfig", () => {
  test("creates file if it doesn't exist", async () => {
    await writeConfig(dir, { plugin: ["a"] });
    const raw = await readFile(join(dir, "opencode.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ plugin: ["a"] });
  });

  test("overwrites existing file", async () => {
    await writeConfig(dir, { plugin: ["a"] });
    await writeConfig(dir, { plugin: ["b"], theme: "light" });
    const raw = await readFile(join(dir, "opencode.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ plugin: ["b"], theme: "light" });
  });

  test("output is pretty-printed with trailing newline", async () => {
    await writeConfig(dir, { x: 1 });
    const raw = await readFile(join(dir, "opencode.json"), "utf-8");
    expect(raw).toBe('{\n  "x": 1\n}\n');
  });
});

describe("readConfig → writeConfig roundtrip", () => {
  test("preserves all keys through read/write cycle", async () => {
    const original = {
      $schema: "https://opencode.ai/config.json",
      plugin: ["@org/code-review"],
      theme: "dark",
      keybinds: { save: "ctrl+s" },
      hugo: {
        workflows: {
          "code-review": sampleEntry,
        },
      },
    };
    await writeConfig(dir, original);
    const read = await readConfig(dir);
    expect(read).toEqual(original);
  });

  test("preserves JSONC comments through read/modify/write cycle", async () => {
    const jsonc = `{
  "$schema": "https://opencode.ai/config.json",
  // User's theme preference
  "theme": "dark",
  /* MCP servers configured by the team */
  "mcp": {
    "jira": { "type": "remote", "url": "https://jira.example.com" }
  },
  "plugin": ["@org/old-workflow"]
}`;
    await writeFile(join(dir, "opencode.json"), jsonc);

    // Read, modify Hugo-managed keys, write back
    const config = await readConfig(dir);
    config.plugin = ["@org/new-workflow"];
    config.hugo = { workflows: { "new-workflow": sampleEntry } };
    await writeConfig(dir, config);

    // Verify comments survived
    const raw = await readFile(join(dir, "opencode.json"), "utf-8");
    expect(raw).toContain("// User's theme preference");
    expect(raw).toContain("/* MCP servers configured by the team */");

    // Verify data is correct
    const reread = await readConfig(dir);
    expect(reread.theme).toBe("dark");
    expect(reread.plugin).toEqual(["@org/new-workflow"]);
    expect(getWorkflow(reread, "new-workflow")).toEqual(sampleEntry);
  });

  test("preserves comments when removing keys", async () => {
    const jsonc = `{
  // Schema for autocomplete
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@org/workflow"],
  "hugo": {
    "workflows": {
      "workflow": ${JSON.stringify(sampleEntry, null, 2).split("\n").join("\n      ")}
    }
  }
}`;
    await writeFile(join(dir, "opencode.json"), jsonc);

    const config = await readConfig(dir);
    config.plugin = [];
    delete config.hugo;
    await writeConfig(dir, config);

    const raw = await readFile(join(dir, "opencode.json"), "utf-8");
    expect(raw).toContain("// Schema for autocomplete");

    const reread = await readConfig(dir);
    expect(reread.$schema).toBe("https://opencode.ai/config.json");
    expect(reread.plugin).toEqual([]);
    expect(reread.hugo).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Plugin array management
// ---------------------------------------------------------------------------

describe("getPlugins", () => {
  test("returns [] when plugin key is missing", () => {
    expect(getPlugins({})).toEqual([]);
  });

  test("returns [] when plugin is not an array", () => {
    expect(getPlugins({ plugin: "not-array" })).toEqual([]);
  });

  test("filters out non-string entries", () => {
    expect(getPlugins({ plugin: ["a", 42, "b", null] })).toEqual(["a", "b"]);
  });

  test("returns string entries", () => {
    expect(getPlugins({ plugin: ["a", "b"] })).toEqual(["a", "b"]);
  });
});

describe("hasPlugin", () => {
  test("returns false when not present", () => {
    expect(hasPlugin({ plugin: ["a"] }, "b")).toBe(false);
  });

  test("returns true when present", () => {
    expect(hasPlugin({ plugin: ["a", "b"] }, "b")).toBe(true);
  });

  test("returns false when plugin key is missing", () => {
    expect(hasPlugin({}, "a")).toBe(false);
  });
});

describe("addPlugin", () => {
  test("adds to empty config", () => {
    const config = addPlugin({}, "@org/pkg");
    expect(getPlugins(config)).toEqual(["@org/pkg"]);
  });

  test("appends to existing array", () => {
    const config = addPlugin({ plugin: ["a"] }, "b");
    expect(getPlugins(config)).toEqual(["a", "b"]);
  });

  test("no-op if already present", () => {
    const config = addPlugin({ plugin: ["a", "b"] }, "b");
    expect(getPlugins(config)).toEqual(["a", "b"]);
  });
});

describe("removePlugin", () => {
  test("removes existing entry", () => {
    const config = removePlugin({ plugin: ["a", "b", "c"] }, "b");
    expect(getPlugins(config)).toEqual(["a", "c"]);
  });

  test("no-op if not present", () => {
    const config = removePlugin({ plugin: ["a"] }, "b");
    expect(getPlugins(config)).toEqual(["a"]);
  });

  test("no-op on empty config", () => {
    const config = removePlugin({}, "a");
    expect(getPlugins(config)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Hugo state (workflows)
// ---------------------------------------------------------------------------

describe("getWorkflows", () => {
  test("returns {} when hugo key is missing", () => {
    expect(getWorkflows({})).toEqual({});
  });

  test("returns {} when hugo.workflows is missing", () => {
    expect(getWorkflows({ hugo: {} })).toEqual({});
  });

  test("returns {} when hugo is not an object", () => {
    expect(getWorkflows({ hugo: "bad" })).toEqual({});
  });

  test("returns workflows when present", () => {
    const config = { hugo: { workflows: { cr: sampleEntry } } };
    expect(getWorkflows(config)).toEqual({ cr: sampleEntry });
  });
});

describe("getWorkflow", () => {
  test("returns undefined when not found", () => {
    expect(getWorkflow({}, "cr")).toBeUndefined();
  });

  test("returns entry when found", () => {
    const config = { hugo: { workflows: { cr: sampleEntry } } };
    expect(getWorkflow(config, "cr")).toEqual(sampleEntry);
  });
});

describe("setWorkflow", () => {
  test("creates hugo.workflows if missing", () => {
    const config = setWorkflow({}, "cr", sampleEntry);
    expect(getWorkflow(config, "cr")).toEqual(sampleEntry);
  });

  test("adds to existing workflows", () => {
    const other: WorkflowEntry = { ...sampleEntry, package: "@org/debug" };
    let config: Record<string, unknown> = {};
    config = setWorkflow(config, "cr", sampleEntry);
    config = setWorkflow(config, "debug", other);
    expect(getWorkflow(config, "cr")).toEqual(sampleEntry);
    expect(getWorkflow(config, "debug")).toEqual(other);
  });

  test("overwrites existing entry", () => {
    let config = setWorkflow({}, "cr", sampleEntry);
    const updated = { ...sampleEntry, version: "2.0.0" };
    config = setWorkflow(config, "cr", updated);
    expect(getWorkflow(config, "cr")?.version).toBe("2.0.0");
  });

  test("preserves other config keys", () => {
    const config: Record<string, unknown> = {
      $schema: "https://opencode.ai/config.json",
      theme: "dark",
      plugin: ["other"],
    };
    setWorkflow(config, "cr", sampleEntry);
    expect(config.$schema).toBe("https://opencode.ai/config.json");
    expect(config.theme).toBe("dark");
    expect(config.plugin).toEqual(["other"]);
  });
});

describe("removeWorkflow", () => {
  test("removes existing entry", () => {
    let config = setWorkflow({}, "cr", sampleEntry);
    config = removeWorkflow(config, "cr");
    expect(getWorkflow(config, "cr")).toBeUndefined();
  });

  test("no-op when not found", () => {
    const config = removeWorkflow({}, "cr");
    expect(config).toEqual({});
  });

  test("no-op when hugo key is missing", () => {
    const config: Record<string, unknown> = { theme: "dark" };
    removeWorkflow(config, "cr");
    expect(config).toEqual({ theme: "dark" });
  });

  test("preserves other workflows", () => {
    const other: WorkflowEntry = { ...sampleEntry, package: "@org/debug" };
    let config: Record<string, unknown> = {};
    config = setWorkflow(config, "cr", sampleEntry);
    config = setWorkflow(config, "debug", other);
    config = removeWorkflow(config, "cr");
    expect(getWorkflow(config, "cr")).toBeUndefined();
    expect(getWorkflow(config, "debug")).toEqual(other);
  });
});

// ---------------------------------------------------------------------------
// Integration: plugin array + Hugo state together
// ---------------------------------------------------------------------------

describe("full config management", () => {
  test("install workflow flow: add plugin + set workflow + write + read back", async () => {
    let config = await readConfig(dir);
    config = addPlugin(config, "@org/code-review");
    config = setWorkflow(config, "code-review", sampleEntry);
    await writeConfig(dir, config);

    const reread = await readConfig(dir);
    expect(hasPlugin(reread, "@org/code-review")).toBe(true);
    expect(getWorkflow(reread, "code-review")).toEqual(sampleEntry);
  });

  test("remove workflow flow: remove plugin + remove workflow + write", async () => {
    // Setup
    let config: Record<string, unknown> = {};
    config = addPlugin(config, "@org/code-review");
    config = setWorkflow(config, "code-review", sampleEntry);
    await writeConfig(dir, config);

    // Remove
    config = await readConfig(dir);
    config = removePlugin(config, "@org/code-review");
    config = removeWorkflow(config, "code-review");
    await writeConfig(dir, config);

    const reread = await readConfig(dir);
    expect(hasPlugin(reread, "@org/code-review")).toBe(false);
    expect(getWorkflow(reread, "code-review")).toBeUndefined();
    // plugin key should still exist (as empty array)
    expect(reread.plugin).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveWorkflowTargets
// ---------------------------------------------------------------------------

describe("resolveWorkflowTargets", () => {
  const otherEntry: WorkflowEntry = {
    ...sampleEntry,
    package: "@org/debug",
  };

  function configWithWorkflows(): Record<string, unknown> {
    let config: Record<string, unknown> = {};
    config = setWorkflow(config, "code-review", sampleEntry);
    config = setWorkflow(config, "debug", otherEntry);
    return config;
  }

  test("resolves specific names", () => {
    const config = configWithWorkflows();
    const targets = resolveWorkflowTargets(config, ["code-review"], false);
    expect(targets).toEqual([{ name: "code-review", entry: sampleEntry }]);
  });

  test("resolves multiple names", () => {
    const config = configWithWorkflows();
    const targets = resolveWorkflowTargets(
      config,
      ["code-review", "debug"],
      false,
    );
    expect(targets).toHaveLength(2);
    expect(targets[0].name).toBe("code-review");
    expect(targets[1].name).toBe("debug");
  });

  test("resolves all when all=true", () => {
    const config = configWithWorkflows();
    const targets = resolveWorkflowTargets(config, [], true);
    expect(targets).toHaveLength(2);
    const names = targets.map((t) => t.name).sort();
    expect(names).toEqual(["code-review", "debug"]);
  });

  test("errors when name not found", () => {
    const config = configWithWorkflows();
    expect(() =>
      resolveWorkflowTargets(config, ["nonexistent"], false),
    ).toThrow('Workflow "nonexistent" is not installed.');
  });

  test("errors when names array is empty and all=false", () => {
    const config = configWithWorkflows();
    expect(() => resolveWorkflowTargets(config, [], false)).toThrow(
      "No workflow names specified.",
    );
  });

  test("errors when all=true but no workflows installed", () => {
    expect(() => resolveWorkflowTargets({}, [], true)).toThrow(
      "No workflows installed.",
    );
  });
});

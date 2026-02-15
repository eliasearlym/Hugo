import { describe, test, expect } from "bun:test";
import { detectCollisions } from "../../src/workflows/collisions";
import type { WorkflowEntry } from "../../src/workflows/types";

/**
 * Unit tests for detectCollisions — covers entity types (command, skill)
 * that aren't exercised by the integration tests (which only trigger
 * agent-level collisions via the conflict-workflow fixture).
 *
 * Agent-level cross-workflow, file override, and user config override are
 * already well-covered in integration/health.test.ts, install.test.ts, and
 * enable.test.ts.
 */

// Helper to build a minimal config with workflows and plugins
function makeConfig(opts: {
  workflows: Record<string, Partial<WorkflowEntry>>;
  plugins?: string[];
  agent?: Record<string, unknown>;
  command?: Record<string, unknown>;
  skill?: Record<string, unknown>;
}): Record<string, unknown> {
  const workflows: Record<string, WorkflowEntry> = {};
  for (const [name, partial] of Object.entries(opts.workflows)) {
    workflows[name] = {
      package: partial.package ?? name,
      version: partial.version ?? "1.0.0",
      agents: partial.agents ?? [],
      commands: partial.commands ?? [],
      skills: partial.skills ?? [],
      mcps: partial.mcps ?? [],
    };
  }

  const config: Record<string, unknown> = {
    hugo: { workflows },
    plugin: opts.plugins ?? Object.keys(workflows),
  };

  if (opts.agent) config.agent = opts.agent;
  if (opts.command) config.command = opts.command;
  if (opts.skill) config.skill = opts.skill;

  return config;
}

// A non-existent project dir — file override checks will find nothing,
// isolating tests to cross-workflow and user-config paths only.
const NO_FILES_DIR = "/tmp/hugo-collisions-test-nonexistent";

describe("detectCollisions", () => {
  // -- Cross-workflow collisions for commands and skills --

  test("detects cross-workflow collision for commands", async () => {
    const config = makeConfig({
      workflows: {
        "wf-a": { commands: ["review", "check"] },
        "wf-b": { commands: ["review"] },
      },
    });

    const warnings = await detectCollisions(
      "wf-a",
      { agents: [], commands: ["review", "check"], skills: [] },
      config,
      NO_FILES_DIR,
    );

    const cross = warnings.filter(
      (w) => w.type === "cross-workflow" && w.entity === "command",
    );
    expect(cross).toHaveLength(1);
    expect(cross[0].name).toBe("review");
    expect(cross[0].detail).toContain("wf-b");
  });

  test("detects cross-workflow collision for skills", async () => {
    const config = makeConfig({
      workflows: {
        "wf-a": { skills: ["analysis"] },
        "wf-b": { skills: ["analysis", "testing"] },
      },
    });

    const warnings = await detectCollisions(
      "wf-a",
      { agents: [], commands: [], skills: ["analysis"] },
      config,
      NO_FILES_DIR,
    );

    const cross = warnings.filter(
      (w) => w.type === "cross-workflow" && w.entity === "skill",
    );
    expect(cross).toHaveLength(1);
    expect(cross[0].name).toBe("analysis");
    expect(cross[0].detail).toContain("wf-b");
  });

  // -- User config overrides for commands and skills --

  test("detects user config override for commands", async () => {
    const config = makeConfig({
      workflows: { "wf-a": { commands: ["review"] } },
      command: { review: { description: "user-defined" } },
    });

    const warnings = await detectCollisions(
      "wf-a",
      { agents: [], commands: ["review"], skills: [] },
      config,
      NO_FILES_DIR,
    );

    const overrides = warnings.filter(
      (w) => w.type === "overridden-by-user-config" && w.entity === "command",
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0].name).toBe("review");
  });

  test("detects user config override for skills", async () => {
    const config = makeConfig({
      workflows: { "wf-a": { skills: ["analysis"] } },
      skill: { analysis: { description: "user-defined" } },
    });

    const warnings = await detectCollisions(
      "wf-a",
      { agents: [], commands: [], skills: ["analysis"] },
      config,
      NO_FILES_DIR,
    );

    const overrides = warnings.filter(
      (w) => w.type === "overridden-by-user-config" && w.entity === "skill",
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0].name).toBe("analysis");
  });
});

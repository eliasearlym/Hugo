import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createTempDir } from "../helpers";
import { build } from "../../src/commands/build";

let projectDir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir: projectDir, cleanup } = await createTempDir());
});

afterEach(async () => {
  await cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writePackageJson(
  fields: Record<string, unknown> = {},
): Promise<void> {
  await writeFile(
    join(projectDir, "package.json"),
    JSON.stringify({
      name: "test-workflow",
      version: "1.0.0",
      description: "A test workflow",
      ...fields,
    }),
  );
}

async function createAgent(name: string): Promise<void> {
  const dir = join(projectDir, "agents");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.md`), `# ${name}`);
}

async function createCommand(name: string): Promise<void> {
  const dir = join(projectDir, "commands");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.md`), `# ${name}`);
}

async function createSkill(name: string): Promise<void> {
  const dir = join(projectDir, "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `# ${name}`);
}

async function readManifest(): Promise<Record<string, unknown>> {
  const raw = await readFile(join(projectDir, "workflow.json"), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("build", () => {
  test("builds manifest from agents, commands, and skills", async () => {
    await writePackageJson();
    await createAgent("reviewer");
    await createAgent("linter");
    await createCommand("review");
    await createSkill("analysis");

    const result = await build({ projectDir });

    expect(result.agents).toEqual(["linter", "reviewer"]);
    expect(result.commands).toEqual(["review"]);
    expect(result.skills).toEqual(["analysis"]);
    expect(result.warnings).toEqual([]);

    // Verify workflow.json was written
    const manifest = await readManifest();
    expect(manifest.agents).toEqual(["linter", "reviewer"]);
    expect(manifest.commands).toEqual(["review"]);
    expect(manifest.skills).toEqual(["analysis"]);
  });

  test("builds with agents only", async () => {
    await writePackageJson();
    await createAgent("planner");
    await createAgent("executor");

    const result = await build({ projectDir });

    expect(result.agents).toEqual(["executor", "planner"]);
    expect(result.commands).toEqual([]);
    expect(result.skills).toEqual([]);
  });

  test("builds with commands only", async () => {
    await writePackageJson();
    await createCommand("deploy");

    const result = await build({ projectDir });

    expect(result.agents).toEqual([]);
    expect(result.commands).toEqual(["deploy"]);
    expect(result.skills).toEqual([]);
  });

  test("builds with skills only", async () => {
    await writePackageJson();
    await createSkill("testing");

    const result = await build({ projectDir });

    expect(result.agents).toEqual([]);
    expect(result.commands).toEqual([]);
    expect(result.skills).toEqual(["testing"]);
  });

  test("errors when package.json contains invalid JSON", async () => {
    await writeFile(join(projectDir, "package.json"), "{{not valid json");
    await mkdir(join(projectDir, "agents"), { recursive: true });
    await writeFile(join(projectDir, "agents", "test.md"), "# test");

    await expect(build({ projectDir })).rejects.toThrow(
      "package.json contains invalid JSON.",
    );
  });

  test("errors when no package.json found", async () => {
    await mkdir(join(projectDir, "agents"), { recursive: true });
    await writeFile(join(projectDir, "agents", "test.md"), "# test");

    await expect(build({ projectDir })).rejects.toThrow(
      "No package.json found. Run hugo build from a workflow package directory.",
    );
  });

  test("warns when package.json missing name", async () => {
    await writePackageJson({ name: undefined });
    await createAgent("reviewer");

    const result = await build({ projectDir });

    expect(result.warnings).toContain('package.json missing "name" field.');
  });

  test("warns when package.json missing description", async () => {
    await writePackageJson({ description: undefined });
    await createAgent("reviewer");

    const result = await build({ projectDir });

    expect(result.warnings).toContain(
      'package.json missing "description" field.',
    );
  });

  test("no warning when package.json has name and description", async () => {
    await writePackageJson({ description: "A test workflow" });
    await createAgent("reviewer");

    const result = await build({ projectDir });

    expect(result.warnings).toEqual([]);
  });

  test("errors when no agents, commands, or skills found", async () => {
    await writePackageJson();

    await expect(build({ projectDir })).rejects.toThrow(
      "No agents, commands, or skills found. Nothing to build.",
    );
  });

  test("errors when directories exist but are empty", async () => {
    await writePackageJson();
    await mkdir(join(projectDir, "agents"), { recursive: true });
    await mkdir(join(projectDir, "commands"), { recursive: true });
    await mkdir(join(projectDir, "skills"), { recursive: true });

    await expect(build({ projectDir })).rejects.toThrow(
      "No agents, commands, or skills found. Nothing to build.",
    );
  });

  test("ignores non-.md files in agents directory", async () => {
    await writePackageJson();
    await mkdir(join(projectDir, "agents"), { recursive: true });
    await writeFile(join(projectDir, "agents", "reviewer.md"), "# reviewer");
    await writeFile(
      join(projectDir, "agents", "notes.txt"),
      "not a workflow file",
    );
    await writeFile(
      join(projectDir, "agents", ".DS_Store"),
      "system file",
    );

    const result = await build({ projectDir });

    expect(result.agents).toEqual(["reviewer"]);
  });

  test("warns and skips skill directory missing SKILL.md", async () => {
    await writePackageJson();
    await createAgent("reviewer");
    // Create a skill dir without SKILL.md
    await mkdir(join(projectDir, "skills", "broken-skill"), {
      recursive: true,
    });
    await writeFile(
      join(projectDir, "skills", "broken-skill", "other.md"),
      "not SKILL.md",
    );
    // Create a valid skill
    await createSkill("valid-skill");

    const result = await build({ projectDir });

    expect(result.skills).toEqual(["valid-skill"]);
    expect(result.warnings).toContain(
      "skills/broken-skill/ is missing SKILL.md — skipped.",
    );
  });

  test("ignores non-directory entries in skills directory", async () => {
    await writePackageJson();
    await createSkill("analysis");
    // Put a file directly in skills/
    await writeFile(
      join(projectDir, "skills", "README.md"),
      "not a skill dir",
    );

    const result = await build({ projectDir });

    expect(result.skills).toEqual(["analysis"]);
  });

  test("sorts names alphabetically within each category", async () => {
    await writePackageJson();
    await createAgent("zebra");
    await createAgent("alpha");
    await createAgent("middle");
    await createCommand("zeta");
    await createCommand("beta");

    const result = await build({ projectDir });

    expect(result.agents).toEqual(["alpha", "middle", "zebra"]);
    expect(result.commands).toEqual(["beta", "zeta"]);
  });

  test("overwrites existing workflow.json", async () => {
    await writePackageJson();
    // Write an old manifest
    await writeFile(
      join(projectDir, "workflow.json"),
      JSON.stringify({ agents: ["old"], commands: [], skills: [] }),
    );
    await createAgent("new-agent");

    const result = await build({ projectDir });

    expect(result.agents).toEqual(["new-agent"]);

    const manifest = await readManifest();
    expect(manifest.agents).toEqual(["new-agent"]);
  });

  test("manifest is valid JSON with correct structure", async () => {
    await writePackageJson();
    await createAgent("reviewer");
    await createCommand("review");
    await createSkill("analysis");

    await build({ projectDir });

    const raw = await readFile(join(projectDir, "workflow.json"), "utf-8");
    // Should end with newline
    expect(raw.endsWith("\n")).toBe(true);

    const manifest = JSON.parse(raw);
    // Should only have agents, commands, skills keys
    expect(Object.keys(manifest).sort()).toEqual([
      "agents",
      "commands",
      "skills",
    ]);
  });
});

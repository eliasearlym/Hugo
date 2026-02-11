import { describe, test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { collectManifestPaths, walkDir, cleanEmptySkillDirs } from "../../src/workflows/sync";
import { parseManifest } from "../../src/workflows/manifest";
import { createTempDir, fileExists, fixtureDir } from "../helpers";

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

describe("collectManifestPaths", () => {
  test("maps agents/commands/skills correctly", async () => {
    const packageDir = fixtureDir("basic-workflow");
    const manifestContent = await readFile(join(packageDir, "hugo-workflow.json"), "utf-8");
    const manifest = parseManifest(manifestContent);

    const paths = await collectManifestPaths(manifest, packageDir);

    // Should have: 1 agent + 1 command + 2 skill files = 4 paths
    expect(paths.length).toBe(4);

    // Agent: agents/reviewer.md → agents/reviewer.md
    const agent = paths.find((p) => p.destination === "agents/reviewer.md");
    expect(agent).toBeDefined();
    expect(agent!.sourcePath).toBe("agents/reviewer.md");

    // Command: commands/review.md → commands/review.md
    const command = paths.find((p) => p.destination === "commands/review.md");
    expect(command).toBeDefined();
    expect(command!.sourcePath).toBe("commands/review.md");

    // Skill files: skills/analysis/SKILL.md and skills/analysis/scripts/run.sh
    const skillMd = paths.find((p) => p.destination === "skills/analysis/SKILL.md");
    expect(skillMd).toBeDefined();
    expect(skillMd!.sourcePath).toBe("skills/analysis/SKILL.md");

    const skillSh = paths.find((p) => p.destination === "skills/analysis/scripts/run.sh");
    expect(skillSh).toBeDefined();
    expect(skillSh!.sourcePath).toBe("skills/analysis/scripts/run.sh");
  });

  test("with non-existent skill dir — throws helpful error", async () => {
    const tmpDir = await setup();

    // Create a minimal manifest referencing a non-existent skill dir
    const manifest = parseManifest(
      JSON.stringify({
        name: "test",
        description: "test",
        skills: [{ path: "skills/nonexistent" }],
      }),
    );

    await expect(collectManifestPaths(manifest, tmpDir)).rejects.toThrow(
      "Failed to read skill directory",
    );
  });
});

describe("walkDir", () => {
  test("skips dotfiles and node_modules", async () => {
    const tmpDir = await setup();

    // Create regular files
    await writeFile(join(tmpDir, "regular.txt"), "content");
    await mkdir(join(tmpDir, "subdir"), { recursive: true });
    await writeFile(join(tmpDir, "subdir", "nested.txt"), "content");

    // Create dotfiles
    await writeFile(join(tmpDir, ".hidden"), "secret");
    await mkdir(join(tmpDir, ".hidden-dir"), { recursive: true });
    await writeFile(join(tmpDir, ".hidden-dir", "file.txt"), "content");

    // Create node_modules
    await mkdir(join(tmpDir, "node_modules"), { recursive: true });
    await writeFile(join(tmpDir, "node_modules", "pkg.js"), "content");

    const files = await walkDir(tmpDir);

    // Should only include regular files, not dotfiles or node_modules
    expect(files).toContain("regular.txt");
    expect(files).toContain(join("subdir", "nested.txt"));

    // Should NOT include dotfiles or node_modules
    expect(files).not.toContain(".hidden");
    expect(files).not.toContain(join(".hidden-dir", "file.txt"));
    expect(files).not.toContain(join("node_modules", "pkg.js"));
  });

  test("on empty directory — returns empty array", async () => {
    const tmpDir = await setup();

    const files = await walkDir(tmpDir);

    expect(files).toEqual([]);
  });
});

describe("cleanEmptySkillDirs", () => {
  test("removes empty dirs", async () => {
    const opencodeDir = await setup();

    // Create empty skill subdirectories
    await mkdir(join(opencodeDir, "skills", "analysis", "scripts"), { recursive: true });
    await mkdir(join(opencodeDir, "skills", "analysis", "helpers"), { recursive: true });

    // analysis/scripts and analysis/helpers are empty
    await cleanEmptySkillDirs(opencodeDir, [
      "skills/analysis/scripts/run.sh",
      "skills/analysis/helpers/format.sh",
    ]);

    // Empty dirs should be cleaned up
    expect(await fileExists(join(opencodeDir, "skills", "analysis", "scripts"))).toBe(false);
    expect(await fileExists(join(opencodeDir, "skills", "analysis", "helpers"))).toBe(false);
    // Parent should also be cleaned if empty
    expect(await fileExists(join(opencodeDir, "skills", "analysis"))).toBe(false);
  });

  test("leaves non-empty dirs", async () => {
    const opencodeDir = await setup();

    // Create skill dir with a file
    await mkdir(join(opencodeDir, "skills", "analysis", "scripts"), { recursive: true });
    await writeFile(join(opencodeDir, "skills", "analysis", "SKILL.md"), "# Skill");
    // scripts/ is empty, but analysis/ has SKILL.md

    await cleanEmptySkillDirs(opencodeDir, ["skills/analysis/scripts/run.sh"]);

    // scripts/ should be removed (it's empty)
    expect(await fileExists(join(opencodeDir, "skills", "analysis", "scripts"))).toBe(false);
    // analysis/ should remain (it still has SKILL.md)
    expect(await fileExists(join(opencodeDir, "skills", "analysis"))).toBe(true);
    expect(await fileExists(join(opencodeDir, "skills", "analysis", "SKILL.md"))).toBe(true);
  });

  test("with empty input — no-op, no crash", async () => {
    const opencodeDir = await setup();

    // Should not throw
    await cleanEmptySkillDirs(opencodeDir, []);

    // Calling with non-skill paths should also be a no-op
    await cleanEmptySkillDirs(opencodeDir, ["agents/reviewer.md"]);
  });
});

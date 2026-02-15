import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile, rm, readFile, stat } from "node:fs/promises";
import { createTempDir } from "../helpers";
import { syncSkills, unsyncSkills, resyncSkills } from "../../src/workflows/sync";

let tmpDir: string;
let cleanup: () => Promise<void>;
let opencodeDir: string;
let packageDir: string;

beforeEach(async () => {
  ({ dir: tmpDir, cleanup } = await createTempDir());
  opencodeDir = join(tmpDir, ".opencode");
  packageDir = join(tmpDir, "pkg");
  await mkdir(join(opencodeDir, "skills"), { recursive: true });
  await mkdir(packageDir, { recursive: true });
});

afterEach(async () => {
  await cleanup();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function createPackageSkill(name: string, files?: Record<string, string>) {
  const skillDir = join(packageDir, "skills", name);
  await mkdir(skillDir, { recursive: true });
  const allFiles = { "SKILL.md": `# ${name} skill`, ...files };
  for (const [fileName, content] of Object.entries(allFiles)) {
    const filePath = join(skillDir, fileName);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, content);
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileContentAt(path: string): Promise<string> {
  return readFile(path, "utf-8");
}

// ===========================================================================
// syncSkills
// ===========================================================================

describe("syncSkills", () => {
  test("copies skill directory to .opencode/skills/", async () => {
    await createPackageSkill("analysis");

    const result = await syncSkills(opencodeDir, packageDir, ["analysis"]);

    expect(result.entries).toEqual({ analysis: { status: "synced" } });
    expect(result.warnings).toEqual([]);
    expect(await dirExists(join(opencodeDir, "skills", "analysis"))).toBe(true);
    expect(
      await fileContentAt(join(opencodeDir, "skills", "analysis", "SKILL.md")),
    ).toBe("# analysis skill");
  });

  test("copies subdirectories and multiple files", async () => {
    await createPackageSkill("analysis", {
      "scripts/run.sh": "#!/bin/bash\necho hi",
      "helpers/format.sh": "#!/bin/bash\necho fmt",
    });

    const result = await syncSkills(opencodeDir, packageDir, ["analysis"]);

    expect(result.entries.analysis.status).toBe("synced");
    expect(
      await fileContentAt(join(opencodeDir, "skills", "analysis", "scripts", "run.sh")),
    ).toBe("#!/bin/bash\necho hi");
    expect(
      await fileContentAt(join(opencodeDir, "skills", "analysis", "helpers", "format.sh")),
    ).toBe("#!/bin/bash\necho fmt");
  });

  test("skips when destination already exists", async () => {
    await createPackageSkill("analysis");
    // Pre-create the destination
    const destDir = join(opencodeDir, "skills", "analysis");
    await mkdir(destDir, { recursive: true });
    await writeFile(join(destDir, "SKILL.md"), "# User's version");

    const result = await syncSkills(opencodeDir, packageDir, ["analysis"]);

    expect(result.entries).toEqual({ analysis: { status: "skipped" } });
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("already exists");
    // User's file should be untouched
    expect(await fileContentAt(join(destDir, "SKILL.md"))).toBe("# User's version");
  });

  test("warns when source directory is missing", async () => {
    // Don't create any skill directory in the package
    const result = await syncSkills(opencodeDir, packageDir, ["phantom"]);

    expect(result.entries).toEqual({});
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("directory is missing");
  });

  test("warns when source directory has no SKILL.md", async () => {
    const skillDir = join(packageDir, "skills", "broken");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "README.md"), "# Not a SKILL.md");

    const result = await syncSkills(opencodeDir, packageDir, ["broken"]);

    expect(result.entries).toEqual({});
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("missing SKILL.md");
  });

  test("handles empty skill names array", async () => {
    const result = await syncSkills(opencodeDir, packageDir, []);

    expect(result.entries).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  test("handles multiple skills with mixed outcomes", async () => {
    await createPackageSkill("good-skill");
    // "phantom" has no source directory
    // Pre-create "existing" at destination
    await mkdir(join(opencodeDir, "skills", "existing"), { recursive: true });
    await writeFile(join(opencodeDir, "skills", "existing", "SKILL.md"), "# User");
    await createPackageSkill("existing");

    const result = await syncSkills(opencodeDir, packageDir, [
      "good-skill",
      "phantom",
      "existing",
    ]);

    expect(result.entries["good-skill"]).toEqual({ status: "synced" });
    expect(result.entries["phantom"]).toBeUndefined();
    expect(result.entries["existing"]).toEqual({ status: "skipped" });
    expect(result.warnings.length).toBe(2); // missing dir + already exists
  });
});

// ===========================================================================
// unsyncSkills
// ===========================================================================

describe("unsyncSkills", () => {
  test("removes synced skill directories", async () => {
    // Simulate a previously synced skill
    const skillDir = join(opencodeDir, "skills", "analysis");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Analysis");

    const result = await unsyncSkills(opencodeDir, ["analysis"], {
      analysis: { status: "synced" },
    });

    expect(result.removed).toEqual(["analysis"]);
    expect(result.kept).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(await dirExists(skillDir)).toBe(false);
  });

  test("keeps skipped skill directories", async () => {
    const skillDir = join(opencodeDir, "skills", "analysis");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# User's analysis");

    const result = await unsyncSkills(opencodeDir, ["analysis"], {
      analysis: { status: "skipped" },
    });

    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual(["analysis"]);
    expect(result.warnings).toEqual([]);
    expect(await dirExists(skillDir)).toBe(true);
  });

  test("handles already-deleted directory gracefully (ENOENT)", async () => {
    // Don't create the directory — simulate user manual deletion
    const result = await unsyncSkills(opencodeDir, ["analysis"], {
      analysis: { status: "synced" },
    });

    expect(result.removed).toEqual(["analysis"]);
    expect(result.warnings).toEqual([]);
  });

  test("returns empty results when syncState is undefined", async () => {
    const result = await unsyncSkills(opencodeDir, ["analysis"], undefined);

    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("keeps skills with no sync entry", async () => {
    const result = await unsyncSkills(opencodeDir, ["unknown"], {
      analysis: { status: "synced" },
    });

    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual(["unknown"]);
  });

  test("handles empty skill names array", async () => {
    const result = await unsyncSkills(opencodeDir, [], {
      analysis: { status: "synced" },
    });

    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("removes recursively including subdirectories", async () => {
    const skillDir = join(opencodeDir, "skills", "analysis");
    await mkdir(join(skillDir, "scripts"), { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Analysis");
    await writeFile(join(skillDir, "scripts", "run.sh"), "#!/bin/bash");

    const result = await unsyncSkills(opencodeDir, ["analysis"], {
      analysis: { status: "synced" },
    });

    expect(result.removed).toEqual(["analysis"]);
    expect(await dirExists(skillDir)).toBe(false);
  });
});

// ===========================================================================
// resyncSkills
// ===========================================================================

describe("resyncSkills", () => {
  test("removes skills no longer in manifest", async () => {
    const skillDir = join(opencodeDir, "skills", "old-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Old");

    const result = await resyncSkills(
      opencodeDir,
      packageDir,
      [],                  // new skills: none
      ["old-skill"],       // old skills
      { "old-skill": { status: "synced" } },
    );

    expect(result.entries).toEqual({});
    expect(await dirExists(skillDir)).toBe(false);
  });

  test("syncs newly added skills", async () => {
    await createPackageSkill("new-skill");

    const result = await resyncSkills(
      opencodeDir,
      packageDir,
      ["new-skill"],       // new skills
      [],                  // old skills: none
      {},
    );

    expect(result.entries["new-skill"]).toEqual({ status: "synced" });
    expect(await dirExists(join(opencodeDir, "skills", "new-skill"))).toBe(true);
  });

  test("re-copies continuing synced skills to get latest version", async () => {
    // Create old version on disk
    const skillDir = join(opencodeDir, "skills", "analysis");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Old version");

    // Create new version in package
    await createPackageSkill("analysis");

    const result = await resyncSkills(
      opencodeDir,
      packageDir,
      ["analysis"],        // new skills
      ["analysis"],        // old skills
      { analysis: { status: "synced" } },
    );

    expect(result.entries.analysis).toEqual({ status: "synced" });
    // Should have the new version
    expect(
      await fileContentAt(join(opencodeDir, "skills", "analysis", "SKILL.md")),
    ).toBe("# analysis skill");
  });

  test("keeps continuing skipped skills untouched", async () => {
    const skillDir = join(opencodeDir, "skills", "analysis");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# User's version");

    await createPackageSkill("analysis");

    const result = await resyncSkills(
      opencodeDir,
      packageDir,
      ["analysis"],
      ["analysis"],
      { analysis: { status: "skipped" } },
    );

    expect(result.entries.analysis).toEqual({ status: "skipped" });
    // User's file should be untouched
    expect(
      await fileContentAt(join(opencodeDir, "skills", "analysis", "SKILL.md")),
    ).toBe("# User's version");
  });

  test("syncs previously skipped skill if user deleted it", async () => {
    // Don't create the directory — user deleted it
    await createPackageSkill("analysis");

    const result = await resyncSkills(
      opencodeDir,
      packageDir,
      ["analysis"],
      ["analysis"],
      { analysis: { status: "skipped" } },
    );

    expect(result.entries.analysis).toEqual({ status: "synced" });
    expect(await dirExists(join(opencodeDir, "skills", "analysis"))).toBe(true);
  });

  test("treats continuing skills with no old sync state as new", async () => {
    await createPackageSkill("analysis");

    const result = await resyncSkills(
      opencodeDir,
      packageDir,
      ["analysis"],
      ["analysis"],
      undefined,           // pre-feature workflow, no sync state
    );

    expect(result.entries.analysis).toEqual({ status: "synced" });
  });

  test("handles all three cases simultaneously", async () => {
    // Set up: "removed" exists and was synced, "continuing" exists and was synced,
    // "added" is new in the package
    const removedDir = join(opencodeDir, "skills", "removed");
    await mkdir(removedDir, { recursive: true });
    await writeFile(join(removedDir, "SKILL.md"), "# Removed");

    const continuingDir = join(opencodeDir, "skills", "continuing");
    await mkdir(continuingDir, { recursive: true });
    await writeFile(join(continuingDir, "SKILL.md"), "# Old continuing");

    await createPackageSkill("continuing");
    await createPackageSkill("added");

    const result = await resyncSkills(
      opencodeDir,
      packageDir,
      ["continuing", "added"],     // new manifest
      ["removed", "continuing"],    // old manifest
      {
        removed: { status: "synced" },
        continuing: { status: "synced" },
      },
    );

    // removed: directory gone
    expect(await dirExists(removedDir)).toBe(false);
    // continuing: re-copied
    expect(result.entries.continuing).toEqual({ status: "synced" });
    expect(
      await fileContentAt(join(opencodeDir, "skills", "continuing", "SKILL.md")),
    ).toBe("# continuing skill");
    // added: copied
    expect(result.entries.added).toEqual({ status: "synced" });
    expect(await dirExists(join(opencodeDir, "skills", "added"))).toBe(true);
  });
});

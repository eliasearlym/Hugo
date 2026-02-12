import { join } from "node:path";
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import type { WorkflowManifest } from "../workflows/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BuildOptions = {
  projectDir: string;
};

export type BuildResult = {
  agents: string[];
  commands: string[];
  skills: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Build command
// ---------------------------------------------------------------------------

/**
 * Generate workflow.json from conventional directory structure.
 * Scans agents, commands (.md files), and skills (directories with SKILL.md).
 * Does NOT read .md contents, validate frontmatter, or generate code.
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
  const { projectDir } = options;
  const warnings: string[] = [];

  let packageJson: Record<string, unknown>;
  let rawPackageJson: string;
  try {
    rawPackageJson = await readFile(join(projectDir, "package.json"), "utf-8");
  } catch {
    throw new Error(
      "No package.json found. Run hugo build from a workflow package directory.",
    );
  }
  try {
    packageJson = JSON.parse(rawPackageJson) as Record<string, unknown>;
  } catch {
    throw new Error("package.json contains invalid JSON.");
  }

  if (!packageJson.name || typeof packageJson.name !== "string") {
    warnings.push('package.json missing "name" field.');
  }
  if (
    !packageJson.description ||
    typeof packageJson.description !== "string"
  ) {
    warnings.push('package.json missing "description" field.');
  }

  const agents = await scanMdFiles(join(projectDir, "agents"));
  const commands = await scanMdFiles(join(projectDir, "commands"));
  const skills = await scanSkillDirs(join(projectDir, "skills"), warnings);

  if (agents.length === 0 && commands.length === 0 && skills.length === 0) {
    throw new Error("No agents, commands, or skills found. Nothing to build.");
  }

  checkDuplicates(agents, "agents");
  checkDuplicates(commands, "commands");
  checkDuplicates(skills, "skills");

  const manifest: WorkflowManifest = { agents, commands, skills };
  await writeFile(
    join(projectDir, "workflow.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf-8",
  );

  return { agents, commands, skills, warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Scan a directory for .md files and return names (filename minus .md).
 * Returns [] if the directory doesn't exist.
 */
async function scanMdFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (entry.endsWith(".md")) {
      names.push(entry.slice(0, -3));
    }
  }

  return names.sort();
}

/**
 * Scan a directory for skill subdirectories containing SKILL.md.
 * Returns skill names (directory name). Warns for directories missing SKILL.md.
 * Returns [] if the directory doesn't exist.
 * Runs stat calls in parallel for better I/O performance.
 */
async function scanSkillDirs(
  dir: string,
  warnings: string[],
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const entryChecks = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(dir, entry);
      try {
        const entryStat = await stat(entryPath);
        return { entry, isDir: entryStat.isDirectory() };
      } catch {
        return { entry, isDir: false };
      }
    }),
  );

  const dirs = entryChecks.filter((e) => e.isDir);

  const skillChecks = await Promise.all(
    dirs.map(async ({ entry }) => {
      const skillMdPath = join(dir, entry, "SKILL.md");
      try {
        await stat(skillMdPath);
        return { entry, hasSkillMd: true };
      } catch {
        return { entry, hasSkillMd: false };
      }
    }),
  );

  const names: string[] = [];
  for (const { entry, hasSkillMd } of skillChecks) {
    if (hasSkillMd) {
      names.push(entry);
    } else {
      warnings.push(`skills/${entry}/ is missing SKILL.md — skipped.`);
    }
  }

  return names.sort();
}

/**
 * Check for duplicate names within a category. Throws on duplicates.
 *
 * For agents and commands (sourced from filenames), the filesystem prevents
 * duplicates — a directory can't contain two files with the same name. This
 * check is a safety net for skills (where the name comes from directory names)
 * and guards against future changes to the scanning logic.
 */
function checkDuplicates(names: string[], category: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(
        `Duplicate ${category.slice(0, -1)} name: "${name}".`,
      );
    }
    seen.add(name);
  }
}

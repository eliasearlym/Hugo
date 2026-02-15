import { join } from "node:path";
import { getWorkflows, hasPlugin } from "./config";
import { fileExists, getOpencodeDir } from "./utils";
import type { CollisionWarning, CrossCheckScope, SkillSyncState } from "./types";

// ---------------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------------

/**
 * Detect collisions for a single workflow against the rest of the config.
 *
 * Three types of collision:
 *   1. Cross-workflow: another workflow declares the same agent/command/skill name.
 *   2. Overridden by file: .opencode/agents/<name>.md (or commands/) exists.
 *   3. Overridden by user config: agent.<name> or command.<name> in opencode.json.
 *
 * @param workflowName - The workflow being checked (excluded from cross-checks).
 * @param manifest     - What the workflow declares (agents, commands, skills).
 * @param config       - The full opencode.json config object.
 * @param projectDir   - Project root (for .opencode/ file checks).
 * @param scope        - Which other workflows to cross-check against.
 */
export async function detectCollisions(
  workflowName: string,
  manifest: { agents: string[]; commands: string[]; skills: string[] },
  config: Record<string, unknown>,
  projectDir: string,
  scope: CrossCheckScope = "enabled-only",
  syncState?: SkillSyncState,
): Promise<CollisionWarning[]> {
  const warnings: CollisionWarning[] = [];
  const workflows = getWorkflows(config);
  const opencodeDir = getOpencodeDir(projectDir);

  for (const [otherName, otherEntry] of Object.entries(workflows)) {
    if (otherName === workflowName) continue;
    if (scope === "enabled-only" && !hasPlugin(config, otherEntry.package)) {
      continue;
    }

    checkCrossCollisions(warnings, manifest.agents, otherEntry.agents, "agent", otherName);
    checkCrossCollisions(warnings, manifest.commands, otherEntry.commands, "command", otherName);
    checkCrossCollisions(warnings, manifest.skills, otherEntry.skills, "skill", otherName);
  }

  await checkFileOverrides(warnings, manifest.agents, "agent", opencodeDir, "agents");
  await checkFileOverrides(warnings, manifest.commands, "command", opencodeDir, "commands");
  await checkSkillFileOverrides(warnings, manifest.skills, opencodeDir, syncState);

  checkUserConfigOverrides(warnings, manifest.agents, "agent", config);
  checkUserConfigOverrides(warnings, manifest.commands, "command", config);
  checkUserConfigOverrides(warnings, manifest.skills, "skill", config);

  return warnings;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if any names in `ours` appear in `theirs` (another workflow's declarations).
 */
function checkCrossCollisions(
  warnings: CollisionWarning[],
  ours: string[],
  theirs: string[],
  entity: "agent" | "command" | "skill",
  otherWorkflowName: string,
): void {
  const theirSet = new Set(theirs);
  for (const name of ours) {
    if (theirSet.has(name)) {
      warnings.push({
        type: "cross-workflow",
        entity,
        name,
        detail: `conflicts with ${entity} "${name}" from workflow "${otherWorkflowName}"`,
      });
    }
  }
}

/**
 * Check if .opencode/<dirName>/<name>.md exists for any declared name.
 * Runs all stat calls in parallel for better I/O performance.
 */
async function checkFileOverrides(
  warnings: CollisionWarning[],
  names: string[],
  entity: "agent" | "command",
  opencodeDir: string,
  dirName: string,
): Promise<void> {
  if (names.length === 0) return;

  const results = await Promise.all(
    names.map(async (name) => ({
      name,
      exists: await fileExists(join(opencodeDir, dirName, `${name}.md`)),
    })),
  );

  for (const { name, exists } of results) {
    if (exists) {
      warnings.push({
        type: "overridden-by-file",
        entity,
        name,
        detail: `.opencode/${dirName}/${name}.md overrides workflow version`,
      });
    }
  }
}

/**
 * Check if .opencode/skills/<name>/SKILL.md exists for any declared skill name.
 * Skills use a different directory structure than agents/commands.
 */
async function checkSkillFileOverrides(
  warnings: CollisionWarning[],
  names: string[],
  opencodeDir: string,
  syncState?: SkillSyncState,
): Promise<void> {
  if (names.length === 0) return;

  const results = await Promise.all(
    names.map(async (name) => ({
      name,
      exists: await fileExists(join(opencodeDir, "skills", name, "SKILL.md")),
    })),
  );

  for (const { name, exists } of results) {
    if (exists) {
      // If Hugo synced this skill, it's not a user override — skip the warning.
      if (syncState?.[name]?.status === "synced") continue;

      warnings.push({
        type: "overridden-by-file",
        entity: "skill",
        name,
        detail: `.opencode/skills/${name}/SKILL.md overrides workflow version`,
      });
    }
  }
}

/**
 * Check if <entity>.<name> exists as a static key in opencode.json.
 */
function checkUserConfigOverrides(
  warnings: CollisionWarning[],
  names: string[],
  entity: "agent" | "command" | "skill",
  config: Record<string, unknown>,
): void {
  const configSection = config[entity];
  if (
    !configSection ||
    typeof configSection !== "object" ||
    Array.isArray(configSection)
  ) {
    return;
  }

  const entries = configSection as Record<string, unknown>;
  for (const name of names) {
    if (name in entries) {
      warnings.push({
        type: "overridden-by-user-config",
        entity,
        name,
        detail: `is already defined in opencode.json — workflow version will not be used`,
      });
    }
  }
}

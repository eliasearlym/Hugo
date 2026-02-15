import {
  readConfig,
  writeConfig,
  addPlugin,
  hasPlugin,
  setWorkflow,
  resolveWorkflowTargets,
} from "../workflows/config";
import { getPackageDir } from "../workflows/bun";
import { detectCollisions } from "../workflows/collisions";
import { syncSkills } from "../workflows/sync";
import { getOpencodeDir } from "../workflows/utils";
import type { CollisionWarning, WorkflowEntry } from "../workflows/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnableOptions = {
  projectDir: string;
  names: string[];
  all?: boolean;
};

export type EnabledWorkflow = {
  workflowName: string;
  entry: WorkflowEntry;
  alreadyEnabled: boolean;
  warnings: CollisionWarning[];
  syncWarnings: string[];
};

export type EnableResult = {
  workflows: EnabledWorkflow[];
};

// ---------------------------------------------------------------------------
// Enable command
// ---------------------------------------------------------------------------

/** Enable one or more installed workflows. */
export async function enable(options: EnableOptions): Promise<EnableResult> {
  const { projectDir, names, all = false } = options;

  const config = await readConfig(projectDir);
  const targets = resolveWorkflowTargets(config, names, all);
  const results: EnabledWorkflow[] = [];
  let configChanged = false;

  const opencodeDir = getOpencodeDir(projectDir);

  for (const { name, entry } of targets) {
    if (hasPlugin(config, entry.package)) {
      results.push({
        workflowName: name,
        entry,
        alreadyEnabled: true,
        warnings: [],
        syncWarnings: [],
      });
      continue;
    }

    const warnings = await detectCollisions(
      name,
      { agents: entry.agents, commands: entry.commands, skills: entry.skills },
      config,
      projectDir,
      "enabled-only",
      entry.sync?.skills,
    );

    addPlugin(config, entry.package);

    const packageDir = getPackageDir(opencodeDir, entry.package);
    const syncResult = await syncSkills(opencodeDir, packageDir, entry.skills);

    let finalEntry = entry;
    if (Object.keys(syncResult.entries).length > 0) {
      finalEntry = {
        ...entry,
        sync: { skills: syncResult.entries },
      };
      setWorkflow(config, name, finalEntry);
    }

    configChanged = true;

    results.push({
      workflowName: name,
      entry: finalEntry,
      alreadyEnabled: false,
      warnings,
      syncWarnings: syncResult.warnings,
    });
  }

  if (configChanged) {
    await writeConfig(projectDir, config);
  }

  return { workflows: results };
}

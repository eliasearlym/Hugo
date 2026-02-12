import {
  readConfig,
  writeConfig,
  addPlugin,
  hasPlugin,
  resolveWorkflowTargets,
} from "../workflows/config";
import { detectCollisions } from "../workflows/collisions";
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

  for (const { name, entry } of targets) {
    if (hasPlugin(config, entry.package)) {
      results.push({
        workflowName: name,
        entry,
        alreadyEnabled: true,
        warnings: [],
      });
      continue;
    }

    const warnings = await detectCollisions(
      name,
      { agents: entry.agents, commands: entry.commands, skills: entry.skills },
      config,
      projectDir,
    );

    addPlugin(config, entry.package);
    configChanged = true;

    results.push({
      workflowName: name,
      entry,
      alreadyEnabled: false,
      warnings,
    });
  }

  if (configChanged) {
    await writeConfig(projectDir, config);
  }

  return { workflows: results };
}

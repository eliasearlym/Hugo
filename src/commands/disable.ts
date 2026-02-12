import {
  readConfig,
  writeConfig,
  removePlugin,
  hasPlugin,
  resolveWorkflowTargets,
} from "../workflows/config";
import type { WorkflowEntry } from "../workflows/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DisableOptions = {
  projectDir: string;
  names: string[];
  all?: boolean;
};

export type DisabledWorkflow = {
  workflowName: string;
  entry: WorkflowEntry;
  alreadyDisabled: boolean;
};

export type DisableResult = {
  workflows: DisabledWorkflow[];
};

// ---------------------------------------------------------------------------
// Disable command
// ---------------------------------------------------------------------------

/** Disable one or more installed workflows. */
export async function disable(options: DisableOptions): Promise<DisableResult> {
  const { projectDir, names, all = false } = options;

  const config = await readConfig(projectDir);
  const targets = resolveWorkflowTargets(config, names, all);
  const results: DisabledWorkflow[] = [];
  let configChanged = false;

  for (const { name, entry } of targets) {
    if (!hasPlugin(config, entry.package)) {
      results.push({
        workflowName: name,
        entry,
        alreadyDisabled: true,
      });
      continue;
    }

    removePlugin(config, entry.package);
    configChanged = true;

    results.push({
      workflowName: name,
      entry,
      alreadyDisabled: false,
    });
  }

  if (configChanged) {
    await writeConfig(projectDir, config);
  }

  return { workflows: results };
}

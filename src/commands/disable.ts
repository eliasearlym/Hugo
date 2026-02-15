import {
  readConfig,
  writeConfig,
  removePlugin,
  hasPlugin,
  setWorkflow,
  resolveWorkflowTargets,
} from "../workflows/config";
import { unsyncSkills } from "../workflows/sync";
import { getOpencodeDir } from "../workflows/utils";
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
  syncWarnings: string[];
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
  const opencodeDir = getOpencodeDir(projectDir);
  const results: DisabledWorkflow[] = [];
  let configChanged = false;

  for (const { name, entry } of targets) {
    if (!hasPlugin(config, entry.package)) {
      results.push({
        workflowName: name,
        entry,
        alreadyDisabled: true,
        syncWarnings: [],
      });
      continue;
    }

    removePlugin(config, entry.package);

    const unsyncResult = await unsyncSkills(opencodeDir, entry.skills, entry.sync?.skills);

    if (entry.sync) {
      const updatedEntry: WorkflowEntry = { ...entry };
      delete updatedEntry.sync;
      setWorkflow(config, name, updatedEntry);
    }

    configChanged = true;

    results.push({
      workflowName: name,
      entry,
      alreadyDisabled: false,
      syncWarnings: unsyncResult.warnings,
    });
  }

  if (configChanged) {
    await writeConfig(projectDir, config);
  }

  return { workflows: results };
}

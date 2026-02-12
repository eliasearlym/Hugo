import {
  readConfig,
  writeConfig,
  addPlugin,
  removePlugin,
  getWorkflows,
  getWorkflow,
  hasPlugin,
} from "../workflows/config";
import { detectCollisions } from "../workflows/collisions";
import type { CollisionWarning, WorkflowEntry } from "../workflows/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SwitchOptions = {
  projectDir: string;
  names: string[];
};

export type SwitchResult = {
  /** Workflows that are now the active set. */
  enabled: Array<{ workflowName: string; entry: WorkflowEntry }>;
  /** Workflows that were disabled by this switch. */
  disabled: Array<{ workflowName: string; entry: WorkflowEntry }>;
  /** True if no changes were needed (already in the desired state). */
  alreadyActive: boolean;
  warnings: CollisionWarning[];
};

// ---------------------------------------------------------------------------
// Switch command
// ---------------------------------------------------------------------------

/**
 * Disable all currently enabled workflows except the specified ones,
 * and enable the specified ones if not already enabled.
 */
export async function switchWorkflows(
  options: SwitchOptions,
): Promise<SwitchResult> {
  const { projectDir, names } = options;

  if (names.length === 0) {
    throw new Error("No workflow names specified.");
  }

  const config = await readConfig(projectDir);
  const allWorkflows = getWorkflows(config);

  if (Object.keys(allWorkflows).length === 0) {
    throw new Error("No workflows installed.");
  }

  const targetEntries: Array<{ name: string; entry: WorkflowEntry }> = [];
  for (const name of names) {
    const entry = getWorkflow(config, name);
    if (!entry) {
      throw new Error(`Workflow "${name}" is not installed.`);
    }
    targetEntries.push({ name, entry });
  }

  const targetNameSet = new Set(names);

  const toDisable: Array<{ workflowName: string; entry: WorkflowEntry }> = [];
  const toEnable: Array<{ workflowName: string; entry: WorkflowEntry }> = [];

  for (const [workflowName, entry] of Object.entries(allWorkflows)) {
    if (targetNameSet.has(workflowName)) continue;
    if (hasPlugin(config, entry.package)) {
      toDisable.push({ workflowName, entry });
    }
  }

  for (const { name, entry } of targetEntries) {
    if (!hasPlugin(config, entry.package)) {
      toEnable.push({ workflowName: name, entry });
    }
  }

  if (toDisable.length === 0 && toEnable.length === 0) {
    return {
      enabled: targetEntries.map(({ name, entry }) => ({
        workflowName: name,
        entry,
      })),
      disabled: [],
      alreadyActive: true,
      warnings: [],
    };
  }

  for (const { entry } of toDisable) {
    removePlugin(config, entry.package);
  }

  const allWarnings: CollisionWarning[] = [];
  for (const { workflowName, entry } of toEnable) {
    const warnings = await detectCollisions(
      workflowName,
      { agents: entry.agents, commands: entry.commands, skills: entry.skills },
      config,
      projectDir,
    );
    allWarnings.push(...warnings);
    addPlugin(config, entry.package);
  }

  await writeConfig(projectDir, config);

  return {
    enabled: targetEntries.map(({ name, entry }) => ({
      workflowName: name,
      entry,
    })),
    disabled: toDisable,
    alreadyActive: false,
    warnings: allWarnings,
  };
}

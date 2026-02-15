import {
  readConfig,
  writeConfig,
  addPlugin,
  removePlugin,
  getWorkflows,
  getWorkflow,
  setWorkflow,
  hasPlugin,
} from "../workflows/config";
import { getPackageDir } from "../workflows/bun";
import { detectCollisions } from "../workflows/collisions";
import { syncSkills, unsyncSkills } from "../workflows/sync";
import { getOpencodeDir } from "../workflows/utils";
import type { CollisionWarning, SkillSyncState, WorkflowEntry } from "../workflows/types";

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
  syncWarnings: string[];
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
      syncWarnings: [],
    };
  }

  const opencodeDir = getOpencodeDir(projectDir);
  const allSyncWarnings: string[] = [];
  const allWarnings: CollisionWarning[] = [];

  // Track completed enables for rollback — if anything fails after
  // filesystem mutations start, we restore the pre-switch state.
  const enabledOps: Array<{
    entry: WorkflowEntry;
    syncEntries: SkillSyncState;
  }> = [];

  try {
    // Phase 1: Disable — unsync skills first (frees skill directories
    // so enabled workflows can copy their versions)
    for (const { workflowName, entry } of toDisable) {
      removePlugin(config, entry.package);

      const unsyncResult = await unsyncSkills(opencodeDir, entry.skills, entry.sync?.skills);
      allSyncWarnings.push(...unsyncResult.warnings);

      if (entry.sync) {
        const updatedEntry: WorkflowEntry = { ...entry };
        delete updatedEntry.sync;
        setWorkflow(config, workflowName, updatedEntry);
      }
    }

    // Phase 2: Enable — detect collisions, sync skills
    for (const { workflowName, entry } of toEnable) {
      const warnings = await detectCollisions(
        workflowName,
        { agents: entry.agents, commands: entry.commands, skills: entry.skills },
        config,
        projectDir,
      );
      allWarnings.push(...warnings);
      addPlugin(config, entry.package);

      const packageDir = getPackageDir(opencodeDir, entry.package);
      const syncResult = await syncSkills(opencodeDir, packageDir, entry.skills);
      allSyncWarnings.push(...syncResult.warnings);
      enabledOps.push({ entry, syncEntries: syncResult.entries });

      if (Object.keys(syncResult.entries).length > 0) {
        const updatedEntry: WorkflowEntry = {
          ...entry,
          sync: { skills: syncResult.entries },
        };
        setWorkflow(config, workflowName, updatedEntry);
      }
    }

    await writeConfig(projectDir, config);
  } catch (err) {
    // Rollback: restore filesystem to pre-switch state.
    // syncSkills/unsyncSkills handle errors internally (return warnings,
    // never throw), so these rollback calls are safe.
    for (const op of [...enabledOps].reverse()) {
      await unsyncSkills(opencodeDir, op.entry.skills, op.syncEntries);
    }
    for (const { entry } of [...toDisable].reverse()) {
      const packageDir = getPackageDir(opencodeDir, entry.package);
      await syncSkills(opencodeDir, packageDir, entry.skills);
    }
    throw err;
  }

  return {
    enabled: targetEntries.map(({ name, entry }) => ({
      workflowName: name,
      entry,
    })),
    disabled: toDisable,
    alreadyActive: false,
    warnings: allWarnings,
    syncWarnings: allSyncWarnings,
  };
}

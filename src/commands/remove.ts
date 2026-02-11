import { join } from "node:path";
import { rm } from "node:fs/promises";
import { removeDependency } from "../workflows/bun";
import { readWorkflowState, removeEntry, writeWorkflowState } from "../workflows/state";
import { checkIntegrity } from "../workflows/integrity";
import { cleanEmptySkillDirs } from "../workflows/sync";

export type RemoveResult = {
  name: string;
  removed: number;
  kept: number;
  keptFiles: string[];
};

export async function remove(
  opencodeDir: string,
  workflowName: string,
): Promise<RemoveResult> {
  const state = await readWorkflowState(opencodeDir);

  const entry = state.workflows.find((w) => w.name === workflowName);
  if (!entry) {
    throw new Error(`Workflow "${workflowName}" is not installed.`);
  }

  // Check integrity of all files
  const fileStatuses = await checkIntegrity(opencodeDir, entry);

  let removed = 0;
  const keptFiles: string[] = [];

  for (const fs of fileStatuses) {
    const fullPath = join(opencodeDir, fs.file.destination);

    if (fs.status === "modified") {
      keptFiles.push(fs.file.destination);
      continue;
    }

    if (fs.status === "deleted") {
      // Already gone, nothing to do
      removed++;
      continue;
    }

    // Clean — safe to delete
    await rm(fullPath);
    removed++;
  }

  // Clean up empty skill directories (only pass actually-deleted destinations)
  const deletedDests = fileStatuses
    .filter((fs) => fs.status !== "modified")
    .map((fs) => fs.file.destination);
  await cleanEmptySkillDirs(opencodeDir, deletedDests);

  // Remove the bun dependency first — if this fails, state still reflects
  // reality (workflow is installed). Reverse order would leave an orphan in
  // node_modules with no state entry to track it.
  try {
    await removeDependency(opencodeDir, entry.package);
  } catch {
    // Non-fatal — the package might have already been removed manually
  }

  // Remove from state
  const updatedState = removeEntry(state, workflowName);
  await writeWorkflowState(opencodeDir, updatedState);

  return {
    name: workflowName,
    removed,
    kept: keptFiles.length,
    keptFiles,
  };
}



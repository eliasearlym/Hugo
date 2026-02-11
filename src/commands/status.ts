import { readWorkflowState } from "../workflows/state";
import { checkIntegrity } from "../workflows/integrity";
import type { FileStatus } from "../workflows/types";

export type WorkflowStatus = {
  name: string;
  version: string;
  files: FileStatus[];
};

export type StatusResult = {
  workflows: WorkflowStatus[];
};

export async function status(
  opencodeDir: string,
  target?: string,
): Promise<StatusResult> {
  const state = await readWorkflowState(opencodeDir);

  let entries = state.workflows;
  if (target) {
    entries = entries.filter((e) => e.name === target);
    if (entries.length === 0) {
      throw new Error(`Workflow "${target}" is not installed`);
    }
  }

  const workflows: WorkflowStatus[] = [];
  for (const entry of entries) {
    const files = await checkIntegrity(opencodeDir, entry);
    workflows.push({
      name: entry.name,
      version: entry.version,
      files,
    });
  }

  return { workflows };
}

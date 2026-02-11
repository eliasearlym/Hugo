import { readWorkflowState } from "../workflows/state";
import { AGENTS_DIR, SKILLS_DIR, COMMANDS_DIR } from "../workflows/constants";
import type { WorkflowEntry } from "../workflows/types";

export type ListEntry = {
  name: string;
  package: string;
  version: string;
  syncedAt: string;
  agents: number;
  skills: number;
  commands: number;
};

export type ListResult = {
  workflows: ListEntry[];
};

export async function list(opencodeDir: string): Promise<ListResult> {
  const state = await readWorkflowState(opencodeDir);

  return {
    workflows: state.workflows.map((entry) => ({
      name: entry.name,
      package: entry.package,
      version: entry.version,
      syncedAt: entry.syncedAt,
      ...countFiles(entry),
    })),
  };
}

function countFiles(entry: WorkflowEntry) {
  let agents = 0;
  let skills = 0;
  let commands = 0;

  const skillDirs = new Set<string>();

  for (const file of entry.files) {
    if (file.destination.startsWith(AGENTS_DIR + "/")) {
      agents++;
    } else if (file.destination.startsWith(COMMANDS_DIR + "/")) {
      commands++;
    } else if (file.destination.startsWith(SKILLS_DIR + "/")) {
      // Count unique skill directories, not individual files
      const parts = file.destination.split("/");
      if (parts.length >= 2) {
        skillDirs.add(parts[1]);
      }
    }
  }

  skills = skillDirs.size;
  return { agents, skills, commands };
}

import {
  readConfig,
  getWorkflows,
  getWorkflow,
  hasPlugin,
} from "../workflows/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ListOptions = {
  projectDir: string;
  name?: string; // specific workflow, or undefined for all
};

export type WorkflowListEntry = {
  workflowName: string;
  packageName: string;
  version: string;
  enabled: boolean;
  agents: string[];
  commands: string[];
  skills: string[];
  mcps: string[];
};

export type ListResult = {
  workflows: WorkflowListEntry[];
};

// ---------------------------------------------------------------------------
// List command
// ---------------------------------------------------------------------------

/**
 * List installed workflows with details and enabled/disabled status.
 * Reads only from cached Hugo state in opencode.json — no node_modules access.
 */
export async function list(options: ListOptions): Promise<ListResult> {
  const { projectDir, name } = options;

  const config = await readConfig(projectDir);

  if (name) {
    const entry = getWorkflow(config, name);
    if (!entry) {
      throw new Error(`Workflow "${name}" is not installed.`);
    }
    return {
      workflows: [
        {
          workflowName: name,
          packageName: entry.package,
          version: entry.version,
          enabled: hasPlugin(config, entry.package),
          agents: entry.agents,
          commands: entry.commands,
          skills: entry.skills,
          mcps: entry.mcps,
        },
      ],
    };
  }

  const workflows = getWorkflows(config);
  const entries = Object.entries(workflows);

  if (entries.length === 0) {
    return { workflows: [] };
  }

  return {
    workflows: entries.map(([workflowName, entry]) => ({
      workflowName,
      packageName: entry.package,
      version: entry.version,
      enabled: hasPlugin(config, entry.package),
      agents: entry.agents,
      commands: entry.commands,
      skills: entry.skills,
      mcps: entry.mcps,
    })),
  };
}

import {
  readConfig,
  writeConfig,
  removePlugin,
  getWorkflow,
  removeWorkflow,
} from "../workflows/config";
import { getOpencodeDir } from "../workflows/utils";
import { removeDependency } from "../workflows/bun";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RemoveOptions = {
  projectDir: string;
  name: string;
};

export type RemoveResult = {
  workflowName: string;
  packageName: string;
  agents: string[];
  commands: string[];
  skills: string[];
  mcps: string[];
  bunWarning?: string;
};

// ---------------------------------------------------------------------------
// Remove command
// ---------------------------------------------------------------------------

/** Remove a workflow entirely. */
export async function remove(options: RemoveOptions): Promise<RemoveResult> {
  const { projectDir, name } = options;
  const opencodeDir = getOpencodeDir(projectDir);

  const config = await readConfig(projectDir);
  const entry = getWorkflow(config, name);
  if (!entry) {
    throw new Error(`Workflow "${name}" is not installed.`);
  }

  removePlugin(config, entry.package);
  removeWorkflow(config, name);
  await writeConfig(projectDir, config);

  // bun remove is non-fatal — config is already updated
  const { warning } = await removeDependency(opencodeDir, entry.package);

  return {
    workflowName: name,
    packageName: entry.package,
    agents: entry.agents,
    commands: entry.commands,
    skills: entry.skills,
    mcps: entry.mcps,
    bunWarning: warning,
  };
}

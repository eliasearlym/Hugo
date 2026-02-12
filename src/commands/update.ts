import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  readConfig,
  writeConfig,
  getWorkflows,
  getWorkflow,
  setWorkflow,
  hasPlugin,
} from "../workflows/config";
import { runUpdate, getPackageDir, getInstalledVersion } from "../workflows/bun";
import { parseManifest } from "../workflows/manifest";
import { errorMessage, getOpencodeDir } from "../workflows/utils";
import type { WorkflowEntry } from "../workflows/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpdateOptions = {
  projectDir: string;
  name?: string; // specific workflow, or undefined for all
};

export type WorkflowUpdateDetail = {
  workflowName: string;
  packageName: string;
  oldVersion: string;
  newVersion: string;
  updated: boolean;
  enabled: boolean;
  addedAgents: string[];
  removedAgents: string[];
  addedCommands: string[];
  removedCommands: string[];
  addedSkills: string[];
  removedSkills: string[];
  addedMcps: string[];
  removedMcps: string[];
  warnings: string[];
};

export type UpdateResult = {
  workflows: WorkflowUpdateDetail[];
};

// ---------------------------------------------------------------------------
// Update command
// ---------------------------------------------------------------------------

/** Update all workflows or a specific one. */
export async function update(options: UpdateOptions): Promise<UpdateResult> {
  const { projectDir, name } = options;
  const opencodeDir = getOpencodeDir(projectDir);

  const config = await readConfig(projectDir);
  let targets: Array<{ name: string; entry: WorkflowEntry }>;

  if (name) {
    const entry = getWorkflow(config, name);
    if (!entry) {
      throw new Error(`Workflow "${name}" is not installed.`);
    }
    targets = [{ name, entry }];
  } else {
    const workflows = getWorkflows(config);
    const entries = Object.entries(workflows);
    if (entries.length === 0) {
      throw new Error("No workflows installed.");
    }
    targets = entries.map(([n, e]) => ({ name: n, entry: e }));
  }

  if (name) {
    const target = targets[0];
    await runUpdate(opencodeDir, target.entry.package);
  } else {
    await runUpdate(opencodeDir);
  }

  const results: WorkflowUpdateDetail[] = [];

  for (const target of targets) {
    const packageDir = getPackageDir(opencodeDir, target.entry.package);
    const warnings: string[] = [];

    let newVersion: string;
    try {
      newVersion = await getInstalledVersion(packageDir);
    } catch (err) {
      warnings.push(
        `Could not read version after update: ${errorMessage(err)}. Using cached version.`,
      );
      newVersion = target.entry.version;
    }

    let newManifest;
    try {
      const manifestContent = await readFile(
        join(packageDir, "workflow.json"),
        "utf-8",
      );
      newManifest = parseManifest(manifestContent);
    } catch (err) {
      warnings.push(
        `Could not read workflow.json after update: ${errorMessage(err)}. Using cached manifest data.`,
      );
      newManifest = {
        agents: target.entry.agents,
        commands: target.entry.commands,
        skills: target.entry.skills,
        mcps: target.entry.mcps,
      };
    }

    const versionChanged = newVersion !== target.entry.version;
    const manifestChanged =
      !arraysEqual(newManifest.agents, target.entry.agents) ||
      !arraysEqual(newManifest.commands, target.entry.commands) ||
      !arraysEqual(newManifest.skills, target.entry.skills) ||
      !arraysEqual(newManifest.mcps, target.entry.mcps);

    const updated = versionChanged || manifestChanged;

    if (updated) {
      setWorkflow(config, target.name, {
        package: target.entry.package,
        version: newVersion,
        agents: newManifest.agents,
        commands: newManifest.commands,
        skills: newManifest.skills,
        mcps: newManifest.mcps,
      });
    }

    results.push({
      workflowName: target.name,
      packageName: target.entry.package,
      oldVersion: target.entry.version,
      newVersion,
      updated,
      enabled: hasPlugin(config, target.entry.package),
      addedAgents: diff(newManifest.agents, target.entry.agents),
      removedAgents: diff(target.entry.agents, newManifest.agents),
      addedCommands: diff(newManifest.commands, target.entry.commands),
      removedCommands: diff(target.entry.commands, newManifest.commands),
      addedSkills: diff(newManifest.skills, target.entry.skills),
      removedSkills: diff(target.entry.skills, newManifest.skills),
      addedMcps: diff(newManifest.mcps, target.entry.mcps),
      removedMcps: diff(target.entry.mcps, newManifest.mcps),
      warnings,
    });
  }

  if (results.some((r) => r.updated)) {
    await writeConfig(projectDir, config);
  }

  return { workflows: results };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((item, i) => item === sortedB[i]);
}

/** Items in `a` that are not in `b`. */
function diff(a: string[], b: string[]): string[] {
  const bSet = new Set(b);
  return a.filter((item) => !bSet.has(item));
}

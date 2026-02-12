import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  readConfig,
  writeConfig,
  addPlugin,
  getWorkflow,
  setWorkflow,
} from "../workflows/config";
import {
  installPackage,
  removeDependency,
  getInstalledVersion,
  parsePackageSpec,
  packageNameFromSource,
} from "../workflows/bun";
import { parseManifest } from "../workflows/manifest";
import { deriveWorkflowName, errorMessage, getOpencodeDir } from "../workflows/utils";
import { detectCollisions } from "../workflows/collisions";
import type { CollisionWarning, WorkflowEntry } from "../workflows/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InstallOptions = {
  projectDir: string;
  spec: string;
  force?: boolean;
};

export type InstallResult = {
  workflowName: string;
  packageName: string;
  version: string;
  agents: string[];
  commands: string[];
  skills: string[];
  mcps: string[];
  warnings: CollisionWarning[];
};

// ---------------------------------------------------------------------------
// Install command
// ---------------------------------------------------------------------------

/**
 * Install a workflow package.
 *
 * Rollback: if anything fails after bun add but before writeConfig,
 * run bun remove to clean up the installed package.
 */
export async function install(options: InstallOptions): Promise<InstallResult> {
  const { projectDir, spec, force = false } = options;
  const opencodeDir = getOpencodeDir(projectDir);

  const { source } = parsePackageSpec(spec);

  // For registry sources, we know the name upfront — check early to avoid
  // a pointless download. Read config once and reuse for the entire operation.
  let config: Record<string, unknown> | undefined;

  if (source.type === "registry") {
    const knownPackageName = packageNameFromSource(source);
    const knownWorkflowName = deriveWorkflowName(knownPackageName);
    config = await readConfig(projectDir);
    const existing = getWorkflow(config, knownWorkflowName);

    if (existing && !force) {
      throw new Error(
        `"${knownWorkflowName}" is already installed. Use --force to reinstall.`,
      );
    }

    if (existing && existing.package !== knownPackageName) {
      throw new Error(
        `Workflow name "${knownWorkflowName}" conflicts with already-installed workflow from package "${existing.package}".`,
      );
    }
  }

  const { packageName, packageDir } =
    await installPackage(opencodeDir, spec);

  // For git/file sources, we can only check for duplicates after install
  // because the package name isn't known until bun resolves it.
  const workflowName = deriveWorkflowName(packageName);

  if (source.type !== "registry") {
    config = await readConfig(projectDir);
    const existing = getWorkflow(config, workflowName);

    if (existing && !force) {
      await removeDependency(opencodeDir, packageName);
      throw new Error(
        `"${workflowName}" is already installed. Use --force to reinstall.`,
      );
    }

    if (existing && existing.package !== packageName) {
      await removeDependency(opencodeDir, packageName);
      throw new Error(
        `Workflow name "${workflowName}" conflicts with already-installed workflow from package "${existing.package}".`,
      );
    }
  }

  let manifestContent: string;
  try {
    manifestContent = await readFile(
      join(packageDir, "workflow.json"),
      "utf-8",
    );
  } catch {
    await removeDependency(opencodeDir, packageName);
    throw new Error(
      `Package "${packageName}" is not a workflow package (missing workflow.json).`,
    );
  }

  let manifest;
  try {
    manifest = parseManifest(manifestContent);
  } catch (err) {
    await removeDependency(opencodeDir, packageName);
    throw new Error(
      `Package "${packageName}" has an invalid workflow.json: ${errorMessage(err)}`,
    );
  }

  let version: string;
  try {
    version = await getInstalledVersion(packageDir);
  } catch (err) {
    await removeDependency(opencodeDir, packageName);
    throw err;
  }

  // TypeScript can't see that one of the two branches above always assigns
  // config, so we assert it here.
  const finalConfig = config!;

  const warnings = await detectCollisions(
    workflowName,
    manifest,
    finalConfig,
    projectDir,
  );

  addPlugin(finalConfig, packageName);
  const entry: WorkflowEntry = {
    package: packageName,
    version,
    agents: manifest.agents,
    commands: manifest.commands,
    skills: manifest.skills,
    mcps: manifest.mcps,
  };
  setWorkflow(finalConfig, workflowName, entry);

  try {
    await writeConfig(projectDir, finalConfig);
  } catch (err) {
    await removeDependency(opencodeDir, packageName);
    throw err;
  }

  return {
    workflowName,
    packageName,
    version,
    agents: manifest.agents,
    commands: manifest.commands,
    skills: manifest.skills,
    mcps: manifest.mcps,
    warnings,
  };
}

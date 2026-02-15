import {
  readConfig,
  getWorkflows,
  getWorkflow,
  hasPlugin,
} from "../workflows/config";
import { detectCollisions } from "../workflows/collisions";
import type { CrossCheckScope, HealthReport, WorkflowEntry } from "../workflows/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthOptions = {
  projectDir: string;
  name?: string;
  all?: boolean;
};

export type HealthResult = {
  reports: HealthReport[];
};

// ---------------------------------------------------------------------------
// Health command
// ---------------------------------------------------------------------------

/**
 * Check for naming collisions and shadowing issues across workflows.
 *
 * Cross-check scope depends on invocation:
 *   - No args: enabled workflows only (active conflicts).
 *   - Specific name / --all: all installed (surfaces potential conflicts
 *     even with disabled workflows).
 */
export async function health(options: HealthOptions): Promise<HealthResult> {
  const { projectDir, name, all = false } = options;

  const config = await readConfig(projectDir);
  const allWorkflows = getWorkflows(config);

  let targets: Array<{ name: string; enabled: boolean; entry: WorkflowEntry }>;
  let crossScope: CrossCheckScope;

  if (name) {
    const entry = getWorkflow(config, name);
    if (!entry) {
      throw new Error(`Workflow "${name}" is not installed.`);
    }
    targets = [{ name, enabled: hasPlugin(config, entry.package), entry }];
    crossScope = "all-installed";
  } else if (all) {
    const entries = Object.entries(allWorkflows);
    if (entries.length === 0) {
      throw new Error("No workflows installed.");
    }
    targets = entries.map(([n, e]) => ({
      name: n,
      enabled: hasPlugin(config, e.package),
      entry: e,
    }));
    crossScope = "all-installed";
  } else {
    const entries = Object.entries(allWorkflows);
    if (entries.length === 0) {
      throw new Error("No workflows installed.");
    }
    targets = entries
      .filter(([, e]) => hasPlugin(config, e.package))
      .map(([n, e]) => ({ name: n, enabled: true, entry: e }));
    crossScope = "enabled-only";
  }

  // Collision checks are independent (read-only against the same config),
  // so run them in parallel across all target workflows.
  const reports = await Promise.all(
    targets.map(async (target) => {
      const warnings = await detectCollisions(
        target.name,
        { agents: target.entry.agents, commands: target.entry.commands, skills: target.entry.skills },
        config,
        projectDir,
        crossScope,
        target.entry.sync?.skills,
      );

      return {
        workflow: target.name,
        enabled: target.enabled,
        warnings,
      };
    }),
  );

  return { reports };
}

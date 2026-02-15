/**
 * Shared type definitions for the workflows module.
 *
 * Types here are used across multiple files in workflows/ and commands/.
 * Command-specific types (e.g., InstallOptions, InstallResult) stay co-located
 * in their respective command files since they have a single consumer.
 */

/**
 * Transient source classification used during install.
 * Determines how bun resolves the package. Not persisted in state.
 */
export type PackageSource =
  | { type: "registry"; name: string }
  | { type: "git"; url: string; ref?: string }
  | { type: "file"; path: string };

/**
 * Parsed from workflow.json — what the workflow declares it provides.
 * Used by hugo list, hugo health, and collision detection.
 */
export type WorkflowManifest = {
  agents: string[];
  commands: string[];
  skills: string[];
  mcps: string[];
};

/**
 * Sync status for a single skill directory.
 *
 * - "synced": Hugo copied this skill directory. Safe to remove on disable/remove,
 *   and safe to replace on update.
 * - "skipped": A skill directory already existed at the destination. Hugo didn't touch it.
 */
export type SkillSyncEntry = {
  status: "synced" | "skipped";
};

/**
 * Per-skill sync state. Keys are skill names, values are sync entries.
 */
export type SkillSyncState = Record<string, SkillSyncEntry>;

/**
 * Stored in opencode.json under hugo.workflows.<name>.
 * Cached metadata — refreshed on install and update.
 */
export type WorkflowEntry = {
  package: string;
  version: string;
  agents: string[];
  commands: string[];
  skills: string[];
  mcps: string[];
  sync?: {
    skills: SkillSyncState;
  };
};

/**
 * Controls which other workflows are checked for cross-workflow collisions.
 *
 * - "enabled-only": only workflows currently in the plugin array (default).
 *   Used by install, enable, switch — we only care about active conflicts.
 *
 * - "all-installed": all workflows in hugo.workflows regardless of enabled.
 *   Used by health — surfaces potential conflicts even with disabled workflows.
 */
export type CrossCheckScope = "enabled-only" | "all-installed";

/**
 * A single collision or shadowing issue detected by hugo health.
 */
export type CollisionWarning = {
  type: "cross-workflow" | "overridden-by-file" | "overridden-by-user-config";
  entity: "agent" | "command" | "skill";
  name: string;
  detail: string;
};

/**
 * Per-workflow health report returned by hugo health.
 */
export type HealthReport = {
  workflow: string;
  enabled: boolean;
  warnings: CollisionWarning[];
};

import type { WorkflowManifest } from "./types";
import { errorMessage } from "./utils";

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/**
 * Parse and validate a workflow.json manifest.
 *
 * Validates:
 * - Valid JSON
 * - agents, commands, skills are string arrays (optional, default to [])
 * - No empty strings in arrays
 * - No duplicate names within a category
 */
export function parseManifest(jsonContent: string): WorkflowManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonContent);
  } catch (err) {
    throw new ManifestError(
      `Invalid JSON: ${errorMessage(err)}`,
    );
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ManifestError("Manifest must be a JSON object");
  }

  const obj = raw as Record<string, unknown>;

  const agents = parseStringArray(obj.agents, "agents");
  const commands = parseStringArray(obj.commands, "commands");
  const skills = parseStringArray(obj.skills, "skills");
  const mcps = parseStringArray(obj.mcps, "mcps");

  return { agents, commands, skills, mcps };
}

function parseStringArray(value: unknown, fieldName: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ManifestError(`'${fieldName}' must be an array`);
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (let i = 0; i < value.length; i++) {
    const item = value[i];

    if (typeof item !== "string") {
      throw new ManifestError(
        `${fieldName}[${i}] must be a string, got ${typeof item}`,
      );
    }

    if (item === "") {
      throw new ManifestError(`${fieldName}[${i}] must not be empty`);
    }

    if (seen.has(item)) {
      throw new ManifestError(
        `${fieldName} contains duplicate name: "${item}"`,
      );
    }

    seen.add(item);
    result.push(item);
  }

  return result;
}

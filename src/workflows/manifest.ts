import type { WorkflowManifest } from "./types";
import { errorMessage } from "./utils";

/**
 * Parse and validate a workflow.json manifest.
 *
 * Validates:
 * - Valid JSON
 * - agents, commands, skills are string arrays (optional, default to [])
 * - No empty strings in arrays
 * - No duplicate names within a category
 *
 * Throws plain Error with descriptive messages — callers (install, update)
 * catch generically and wrap with package context.
 */
export function parseManifest(jsonContent: string): WorkflowManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonContent);
  } catch (err) {
    throw new Error(`Invalid JSON: ${errorMessage(err)}`);
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Manifest must be a JSON object");
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
    throw new Error(`'${fieldName}' must be an array`);
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (let i = 0; i < value.length; i++) {
    const item = value[i];

    if (typeof item !== "string") {
      throw new Error(
        `${fieldName}[${i}] must be a string, got ${typeof item}`,
      );
    }

    if (item === "") {
      throw new Error(`${fieldName}[${i}] must not be empty`);
    }

    if (seen.has(item)) {
      throw new Error(
        `${fieldName} contains duplicate name: "${item}"`,
      );
    }

    seen.add(item);
    result.push(item);
  }

  return result;
}

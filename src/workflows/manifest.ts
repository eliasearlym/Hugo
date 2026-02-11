import { normalize } from "node:path";
import type { WorkflowManifest } from "./types";

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

export function parseManifest(jsonContent: string): WorkflowManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonContent);
  } catch (err) {
    throw new ManifestError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!raw || typeof raw !== "object") {
    throw new ManifestError("Manifest must be a JSON object");
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    throw new ManifestError("Manifest requires a non-empty 'name' field");
  }

  if (typeof obj.description !== "string" || obj.description.trim() === "") {
    throw new ManifestError(
      "Manifest requires a non-empty 'description' field",
    );
  }

  const agents = parsePathArray(obj.agents, "agents");
  const skills = parsePathArray(obj.skills, "skills");
  const commands = parsePathArray(obj.commands, "commands");

  for (const agent of agents) {
    validatePath(agent.path, "agent");
    if (!agent.path.endsWith(".md")) {
      throw new ManifestError(
        `Agent path must end in .md: "${agent.path}"`,
      );
    }
  }

  for (const command of commands) {
    validatePath(command.path, "command");
    if (!command.path.endsWith(".md")) {
      throw new ManifestError(
        `Command path must end in .md: "${command.path}"`,
      );
    }
  }

  for (const skill of skills) {
    validatePath(skill.path, "skill");
    if (skill.path.endsWith(".md")) {
      throw new ManifestError(
        `Skill path should be a directory, not a file: "${skill.path}"`,
      );
    }
  }

  return {
    name: obj.name.trim(),
    description: obj.description.trim(),
    agents,
    skills,
    commands,
  };
}

function parsePathArray(
  value: unknown,
  fieldName: string,
): Array<{ path: string }> {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ManifestError(`'${fieldName}' must be an array`);
  }

  return value.map((item, i) => {
    if (!item || typeof item !== "object" || typeof item.path !== "string") {
      throw new ManifestError(
        `${fieldName}[${i}] must have a 'path' string field`,
      );
    }
    return { path: item.path };
  });
}

function validatePath(path: string, kind: string): void {
  if (path.trim() === "") {
    throw new ManifestError(`${kind} path cannot be empty`);
  }

  if (path.startsWith("/")) {
    throw new ManifestError(
      `${kind} path must be relative, not absolute: "${path}"`,
    );
  }

  // Normalize and check for traversal — a normalized path that starts with
  // ".." escapes the package root.
  const normalized = normalize(path);
  if (normalized.startsWith("..")) {
    throw new ManifestError(
      `${kind} path must not escape the package root: "${path}"`,
    );
  }
}

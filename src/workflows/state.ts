import { join } from "node:path";
import { readFile, writeFile, exists } from "node:fs/promises";
import type { WorkflowState, WorkflowEntry, PackageSource } from "./types";
import { STATE_FILE } from "./constants";
import { stripVersion } from "./utils";

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

export async function readWorkflowState(opencodeDir: string): Promise<WorkflowState> {
  const statePath = join(opencodeDir, STATE_FILE);
  if (!(await exists(statePath))) {
    return { workflows: [] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(statePath, "utf-8"));
  } catch (err) {
    throw new StateError(
      `Failed to parse ${STATE_FILE}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!raw || typeof raw !== "object") {
    throw new StateError(`${STATE_FILE} must be a JSON object`);
  }

  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.workflows)) {
    throw new StateError(`${STATE_FILE} must contain a 'workflows' array`);
  }

  const workflows = obj.workflows.map((entry: unknown, i: number) =>
    validateEntry(entry, i),
  );

  return { workflows };
}

function validateEntry(raw: unknown, index: number): WorkflowEntry {
  if (!raw || typeof raw !== "object") {
    throw new StateError(`workflows[${index}] must be an object`);
  }

  const entry = raw as Record<string, unknown>;

  if (typeof entry.name !== "string" || entry.name === "") {
    throw new StateError(`workflows[${index}] requires a non-empty 'name' string`);
  }
  if (typeof entry.package !== "string" || entry.package === "") {
    throw new StateError(`workflows[${index}] requires a non-empty 'package' string`);
  }
  if (typeof entry.version !== "string") {
    throw new StateError(`workflows[${index}] requires a 'version' string`);
  }
  if (typeof entry.syncedAt !== "string") {
    throw new StateError(`workflows[${index}] requires a 'syncedAt' string`);
  }
  if (!Array.isArray(entry.files)) {
    throw new StateError(`workflows[${index}] requires a 'files' array`);
  }

  const source = validateSource(entry.source, index);

  return {
    name: entry.name,
    package: entry.package,
    source,
    version: entry.version,
    syncedAt: entry.syncedAt,
    files: entry.files.map((f: unknown, fi: number) => validateFile(f, index, fi)),
  };
}

function validateSource(raw: unknown, entryIndex: number): PackageSource {
  if (!raw || typeof raw !== "object") {
    throw new StateError(`workflows[${entryIndex}].source must be an object`);
  }

  const source = raw as Record<string, unknown>;

  if (source.type === "registry") {
    if (typeof source.name !== "string" || source.name === "") {
      throw new StateError(
        `workflows[${entryIndex}].source (registry) requires a non-empty 'name' string`,
      );
    }
    return { type: "registry", name: source.name };
  }

  if (source.type === "git") {
    if (typeof source.url !== "string" || source.url === "") {
      throw new StateError(
        `workflows[${entryIndex}].source (git) requires a non-empty 'url' string`,
      );
    }
    return {
      type: "git",
      url: source.url,
      ...(typeof source.ref === "string" ? { ref: source.ref } : {}),
    };
  }

  if (source.type === "file") {
    if (typeof source.path !== "string" || source.path === "") {
      throw new StateError(
        `workflows[${entryIndex}].source (file) requires a non-empty 'path' string`,
      );
    }
    return { type: "file", path: source.path };
  }

  throw new StateError(
    `workflows[${entryIndex}].source.type must be "registry", "git", or "file", got "${String(source.type)}"`,
  );
}

function validateFile(
  raw: unknown,
  entryIndex: number,
  fileIndex: number,
): { source: string; destination: string; hash: string } {
  if (!raw || typeof raw !== "object") {
    throw new StateError(`workflows[${entryIndex}].files[${fileIndex}] must be an object`);
  }

  const file = raw as Record<string, unknown>;

  if (typeof file.source !== "string") {
    throw new StateError(`workflows[${entryIndex}].files[${fileIndex}] requires a 'source' string`);
  }
  if (typeof file.destination !== "string") {
    throw new StateError(`workflows[${entryIndex}].files[${fileIndex}] requires a 'destination' string`);
  }
  if (typeof file.hash !== "string") {
    throw new StateError(`workflows[${entryIndex}].files[${fileIndex}] requires a 'hash' string`);
  }

  return { source: file.source, destination: file.destination, hash: file.hash };
}

export async function writeWorkflowState(
  opencodeDir: string,
  state: WorkflowState,
): Promise<void> {
  const statePath = join(opencodeDir, STATE_FILE);
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

export function addEntry(state: WorkflowState, entry: WorkflowEntry): WorkflowState {
  const filtered = state.workflows.filter(
    (w) => w.name !== entry.name && !sourceEquals(w.source, entry.source),
  );
  return { workflows: [...filtered, entry] };
}

export function removeEntry(state: WorkflowState, name: string): WorkflowState {
  return {
    workflows: state.workflows.filter((w) => w.name !== name),
  };
}

export function findFileOwner(
  state: WorkflowState,
  relativePath: string,
): WorkflowEntry | null {
  for (const entry of state.workflows) {
    if (entry.files.some((f) => f.destination === relativePath)) {
      return entry;
    }
  }
  return null;
}

export function sourceEquals(
  a: WorkflowEntry["source"],
  b: WorkflowEntry["source"],
): boolean {
  if (a.type === "registry" && b.type === "registry") {
    return stripVersion(a.name) === stripVersion(b.name);
  }
  if (a.type === "git" && b.type === "git") {
    return a.url === b.url;
  }
  if (a.type === "file" && b.type === "file") {
    return a.path === b.path;
  }
  return false;
}

import { join } from "node:path";

/**
 * Type guard for Node.js system errors (errors with an `errno` `code` property).
 */
export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

/**
 * Extract a human-readable message from an unknown error value.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const OPENCODE_DIR = ".opencode";

/**
 * Get the path to the .opencode directory for a project.
 */
export function getOpencodeDir(projectDir: string): string {
  return join(projectDir, OPENCODE_DIR);
}

/**
 * Strip version specifier from a registry package name.
 * "@org/pkg@^1.0.0" → "@org/pkg", "pkg@^1.0.0" → "pkg"
 */
export function stripVersion(name: string): string {
  if (name.startsWith("@")) {
    const slashIndex = name.indexOf("/");
    const atIndex = name.indexOf("@", slashIndex + 1);
    return atIndex === -1 ? name : name.slice(0, atIndex);
  }
  const atIndex = name.indexOf("@");
  return atIndex === -1 ? name : name.slice(0, atIndex);
}

/**
 * Derive a workflow name from an npm package name.
 * Strips the scope: "@org/code-review" → "code-review".
 * Unscoped names pass through: "code-review" → "code-review".
 */
export function deriveWorkflowName(packageName: string): string {
  if (packageName.startsWith("@")) {
    const slashIndex = packageName.indexOf("/");
    if (slashIndex !== -1) {
      return packageName.slice(slashIndex + 1);
    }
  }
  return packageName;
}

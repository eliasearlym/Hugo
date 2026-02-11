import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

/**
 * Strip version specifier from a registry package name.
 * "@org/pkg@^1.0.0" → "@org/pkg", "pkg@^1.0.0" → "pkg"
 */
export function stripVersion(name: string): string {
  if (name.startsWith("@")) {
    const afterScope = name.indexOf("/");
    const atIndex = name.indexOf("@", afterScope + 1);
    return atIndex === -1 ? name : name.slice(0, atIndex);
  }
  const atIndex = name.indexOf("@");
  return atIndex === -1 ? name : name.slice(0, atIndex);
}

/**
 * SHA-256 hash of a file's contents, returned as a hex string.
 */
export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

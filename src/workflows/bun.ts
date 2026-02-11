import { $ } from "bun";
import { join } from "node:path";
import { readFile, writeFile, mkdir, exists } from "node:fs/promises";
import type { PackageSource } from "./types";
import { stripVersion } from "./utils";

export async function addDependency(
  opencodeDir: string,
  packageSpec: string,
): Promise<void> {
  await mkdir(opencodeDir, { recursive: true });
  const pkgJsonPath = join(opencodeDir, "package.json");
  if (!(await exists(pkgJsonPath))) {
    await writeFile(pkgJsonPath, JSON.stringify({ dependencies: {} }, null, 2));
  }

  await $`bun add ${packageSpec}`.cwd(opencodeDir).quiet();
}

export async function runUpdate(
  opencodeDir: string,
  packageSpec?: string,
): Promise<void> {
  if (packageSpec) {
    await $`bun update ${packageSpec}`.cwd(opencodeDir).quiet();
  } else {
    await $`bun update`.cwd(opencodeDir).quiet();
  }
}

export async function removeDependency(
  opencodeDir: string,
  packageSpec: string,
): Promise<void> {
  await $`bun remove ${packageSpec}`.cwd(opencodeDir).quiet();
}

export function getPackageDir(
  opencodeDir: string,
  packageName: string,
): string {
  return join(opencodeDir, "node_modules", packageName);
}

export type ParsedPackageSpec = {
  source: PackageSource;
  warnings: string[];
};

/**
 * Registry package names follow a predictable pattern:
 *   - "lodash", "lodash@^1.0.0"
 *   - "@org/pkg", "@org/pkg@^2.0.0"
 *
 * Anything that doesn't match this pattern is a git/URL source.
 * We let bun handle the actual protocol interpretation — Hugo only
 * needs to know "registry" vs "not registry" to pick the right
 * package name resolution strategy.
 */
const REGISTRY_PATTERN = /^(@[a-z0-9\-~][a-z0-9\-._~]*\/)?[a-z0-9\-~][a-z0-9\-._~]*(@.+)?$/i;

export function parsePackageSpec(spec: string): ParsedPackageSpec {
  // file: protocol — local path install
  if (spec.startsWith("file:")) {
    return { source: { type: "file", path: spec.slice(5) }, warnings: [] };
  }

  // Registry package — matches npm naming convention
  if (REGISTRY_PATTERN.test(spec)) {
    return { source: { type: "registry", name: spec }, warnings: [] };
  }

  // GitHub shorthand: "org/repo" or "org/repo#tag"
  // Must have exactly one slash, no @ prefix, and no colon (to avoid matching
  // scoped npm packages and protocol-prefixed specs like "github:org/repo")
  if (!spec.startsWith("@") && !spec.includes(":") && /^[^/]+\/[^/]+$/.test(spec.split("#")[0])) {
    const { url, ref } = splitRef(spec);
    const org = spec.split("/")[0];
    return {
      source: { type: "git", url: `github:${url}`, ref },
      warnings: [
        `Interpreting "${spec}" as a GitHub repo. If you meant the npm package @${org}/${spec.split("/")[1].split("#")[0]}, use that instead.`,
      ],
    };
  }

  // Everything else — git URL, https://, github:, git+ssh://, etc.
  // Bun handles the actual protocol resolution.
  const { url, ref } = splitRef(spec);
  return { source: { type: "git", url, ref }, warnings: [] };
}

export async function getInstalledVersion(
  packageDir: string,
  source: PackageSource,
): Promise<string> {
  const pkgJsonPath = join(packageDir, "package.json");
  const raw = JSON.parse(await readFile(pkgJsonPath, "utf-8"));

  if (source.type === "git") {
    // bun stores the resolved commit in _resolved or gitHead
    return raw._resolved ?? raw.gitHead ?? raw.version ?? "unknown";
  }

  // registry and file sources use the version field
  return raw.version ?? "unknown";
}

/**
 * For git specs that may include a #ref suffix, split them.
 * e.g. "github:org/repo#v1.0.0" → { url: "github:org/repo", ref: "v1.0.0" }
 */
function splitRef(spec: string): { url: string; ref?: string } {
  const hashIndex = spec.indexOf("#");
  if (hashIndex === -1) {
    return { url: spec };
  }
  const ref = spec.slice(hashIndex + 1);
  return {
    url: spec.slice(0, hashIndex),
    ...(ref !== "" ? { ref } : {}),
  };
}

/**
 * Derive a package name from a PackageSource that can be used to locate
 * the package in node_modules.
 */
export function packageNameFromSource(source: PackageSource): string {
  if (source.type === "registry") {
    return stripVersion(source.name);
  }

  // For git and file sources, the package name is determined by the
  // package.json "name" field, which we can't know before install.
  // The caller should read it from the installed package.json after `bun add`.
  throw new Error(
    "Cannot derive node_modules path from git/file source before install. " +
      "Read the package name from the installed package.json instead.",
  );
}

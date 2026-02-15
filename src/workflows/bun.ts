import { $ } from "bun";
import { join } from "node:path";
import { readFile, writeFile, mkdir, exists } from "node:fs/promises";
import type { PackageSource } from "./types";
import { isNodeError, stripVersion, errorMessage } from "./utils";

// ---------------------------------------------------------------------------
// Package spec parsing
// ---------------------------------------------------------------------------

export type ParsedPackageSpec = {
  source: PackageSource;
  warnings: string[];
};

/**
 * Registry package names follow npm naming conventions:
 *   - "lodash", "lodash@^1.0.0"
 *   - "@org/pkg", "@org/pkg@^2.0.0"
 *
 * Anything else is git/URL. We let bun handle the actual resolution —
 * Hugo only needs to distinguish "registry" vs "not registry" for
 * package name derivation.
 */
const REGISTRY_PATTERN =
  /^(@[a-z0-9\-~][a-z0-9\-._~]*\/)?[a-z0-9\-~][a-z0-9\-._~]*(@.+)?$/i;

export function parsePackageSpec(spec: string): ParsedPackageSpec {
  // file: protocol or relative/absolute paths
  if (
    spec.startsWith("file:") ||
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec.startsWith("/")
  ) {
    const path = spec.startsWith("file:") ? spec.slice(5) : spec;
    return { source: { type: "file", path }, warnings: [] };
  }

  // Registry package
  if (REGISTRY_PATTERN.test(spec)) {
    return { source: { type: "registry", name: spec }, warnings: [] };
  }

  // GitHub shorthand: "org/repo" or "org/repo#tag"
  if (
    !spec.startsWith("@") &&
    !spec.includes(":") &&
    /^[^/]+\/[^/]+$/.test(spec.split("#")[0])
  ) {
    const { url, ref } = splitRef(spec);
    const [org, repo] = url.split("/");
    return {
      source: { type: "git", url: `github:${url}`, ref },
      warnings: [
        `Interpreting "${spec}" as a GitHub repo. If you meant the npm package @${org}/${repo}, use that instead.`,
      ],
    };
  }

  // Everything else — github:, https://, git+ssh://, etc.
  const { url, ref } = splitRef(spec);
  return { source: { type: "git", url, ref }, warnings: [] };
}

// ---------------------------------------------------------------------------
// Low-level bun operations
// ---------------------------------------------------------------------------

/**
 * Run `bun add <spec>` in the given directory.
 * Creates package.json if missing.
 */
export async function addDependency(
  opencodeDir: string,
  packageSpec: string,
): Promise<void> {
  await ensurePackageJson(opencodeDir);

  const result = await $`bun add ${packageSpec}`.cwd(opencodeDir).quiet().nothrow();
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(
      `Failed to install "${packageSpec}": ${stderr || "bun add exited with code " + result.exitCode}`,
    );
  }
}

/**
 * Run `bun remove <spec>` in the given directory.
 * Returns { success, warning } — failures are non-fatal for remove flows.
 */
export async function removeDependency(
  opencodeDir: string,
  packageName: string,
): Promise<{ success: boolean; warning?: string }> {
  const result = await $`bun remove ${packageName}`
    .cwd(opencodeDir)
    .quiet()
    .nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    return {
      success: false,
      warning: `bun remove failed for "${packageName}": ${stderr || "exit code " + result.exitCode}`,
    };
  }
  return { success: true };
}

/**
 * Run `bun update` (all or specific package) in the given directory.
 */
export async function runUpdate(
  opencodeDir: string,
  packageName?: string,
): Promise<void> {
  const result = packageName
    ? await $`bun update ${packageName}`.cwd(opencodeDir).quiet().nothrow()
    : await $`bun update`.cwd(opencodeDir).quiet().nothrow();

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    const target = packageName ? `"${packageName}"` : "packages";
    throw new Error(
      `Failed to update ${target}: ${stderr || "bun update exited with code " + result.exitCode}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Package resolution helpers
// ---------------------------------------------------------------------------

/**
 * Get the path to a package inside .opencode/node_modules/.
 */
export function getPackageDir(
  opencodeDir: string,
  packageName: string,
): string {
  return join(opencodeDir, "node_modules", packageName);
}

/**
 * Read the installed version from a package's package.json.
 *
 * Always returns the `version` field. For git-installed packages, this is
 * the version declared in the package's own package.json (not the commit SHA).
 * This is intentional — commit-level precision belongs in the lockfile, and
 * Hugo's version field is for display and basic change detection.
 */
export async function getInstalledVersion(
  packageDir: string,
): Promise<string> {
  const pkgJsonPath = join(packageDir, "package.json");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Failed to read package.json from ${packageDir}: ${errorMessage(err)}`,
    );
  }
  return typeof raw.version === "string" ? raw.version : "unknown";
}

/**
 * Derive a package name from a registry PackageSource.
 * Throws for git/file sources — use installPackage for those.
 */
export function packageNameFromSource(source: PackageSource): string {
  if (source.type === "registry") {
    return stripVersion(source.name);
  }
  throw new Error(
    "Cannot derive package name from git/file source before install. " +
      "Use installPackage() which resolves the name via dep-diffing.",
  );
}

// ---------------------------------------------------------------------------
// installPackage — high-level install with dep-diffing
// ---------------------------------------------------------------------------

export type InstallResult = {
  packageName: string;
  packageDir: string;
  source: PackageSource;
};

/**
 * Install a package and resolve its name + location.
 *
 * For registry sources, the name is known upfront.
 * For git/file sources, we snapshot dependencies before `bun add`,
 * then diff after to find the new package name.
 */
export async function installPackage(
  opencodeDir: string,
  spec: string,
): Promise<InstallResult> {
  const { source } = parsePackageSpec(spec);

  if (source.type === "registry") {
    const packageName = stripVersion(source.name);
    await addDependency(opencodeDir, spec);
    return {
      packageName,
      packageDir: getPackageDir(opencodeDir, packageName),
      source,
    };
  }

  // For git/file sources, snapshot deps before install and diff after
  // to discover the package name (which isn't known upfront).
  //
  // Edge cases like transitive deps, monorepo multi-adds, or side-effect
  // version bumps are not realistic here: .opencode/package.json only
  // contains Hugo-managed direct dependencies, and bun adds exactly one
  // entry per `bun add` invocation. The fallback chain below is defensive
  // but all practical cases resolve in the first two checks.
  const depsBefore = await readDependencies(opencodeDir);
  await addDependency(opencodeDir, spec);
  const depsAfter = await readDependencies(opencodeDir);

  const newPackages = Object.keys(depsAfter).filter(
    (name) => !(name in depsBefore),
  );

  if (newPackages.length === 0) {
    // No new deps — reinstall. Check if the dep value changed (e.g. git
    // source with a different ref on --force reinstall).
    const changedPackages = Object.keys(depsAfter).filter(
      (name) => depsBefore[name] !== depsAfter[name],
    );
    if (changedPackages.length === 1) {
      const packageName = changedPackages[0];
      return {
        packageName,
        packageDir: getPackageDir(opencodeDir, packageName),
        source,
      };
    }

    // Exact reinstall (same version, same ref) — dep value is unchanged.
    // Match by source path/URL substring in the dep value.
    if (source.type === "file") {
      const matchingDeps = Object.entries(depsAfter).filter(([, value]) =>
        value.includes(source.path),
      );
      if (matchingDeps.length === 1) {
        const packageName = matchingDeps[0][0];
        return {
          packageName,
          packageDir: getPackageDir(opencodeDir, packageName),
          source,
        };
      }
    }

    if (source.type === "git") {
      const matchingDeps = Object.entries(depsAfter).filter(([, value]) =>
        value.includes(source.url),
      );
      if (matchingDeps.length === 1) {
        const packageName = matchingDeps[0][0];
        return {
          packageName,
          packageDir: getPackageDir(opencodeDir, packageName),
          source,
        };
      }
    }

    throw new Error(
      `Could not determine package name from "${spec}". ` +
        "No new dependencies were added. Try using the full package name instead.",
    );
  }

  if (newPackages.length > 1) {
    // Defensive: bun add should only add one direct dep. This would require
    // a monorepo or workspace setup that adds multiple entries, which isn't
    // realistic in .opencode/'s isolated context.
    throw new Error(
      `Installing "${spec}" added multiple packages: ${newPackages.join(", ")}. ` +
        "Cannot determine which is the workflow package.",
    );
  }

  const packageName = newPackages[0];
  return {
    packageName,
    packageDir: getPackageDir(opencodeDir, packageName),
    source,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function ensurePackageJson(opencodeDir: string): Promise<void> {
  await mkdir(opencodeDir, { recursive: true });
  const pkgJsonPath = join(opencodeDir, "package.json");
  if (!(await exists(pkgJsonPath))) {
    await writeFile(
      pkgJsonPath,
      JSON.stringify({ dependencies: {} }, null, 2) + "\n",
    );
  }
}

async function readDependencies(
  opencodeDir: string,
): Promise<Record<string, string>> {
  const pkgJsonPath = join(opencodeDir, "package.json");
  let content: string;
  try {
    content = await readFile(pkgJsonPath, "utf-8");
  } catch (err) {
    // File doesn't exist yet — valid state before first install
    if (isNodeError(err) && err.code === "ENOENT") {
      return {};
    }
    throw err;
  }
  try {
    const raw = JSON.parse(content);
    return raw.dependencies ?? {};
  } catch {
    // Corrupt package.json — treat as empty so install can proceed
    return {};
  }
}

function splitRef(spec: string): { url: string; ref?: string } {
  const hashIndex = spec.indexOf("#");
  if (hashIndex === -1) return { url: spec };
  const ref = spec.slice(hashIndex + 1);
  return {
    url: spec.slice(0, hashIndex),
    ...(ref !== "" ? { ref } : {}),
  };
}

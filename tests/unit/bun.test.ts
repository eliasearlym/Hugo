import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { parsePackageSpec, getInstalledVersion, packageNameFromSource } from "../../src/workflows/bun";
import { createTempDir } from "../helpers";

describe("parsePackageSpec", () => {
  // ---------------------------------------------------------------------------
  // Registry packages
  // ---------------------------------------------------------------------------

  describe("registry", () => {
    test("simple package name", () => {
      const result = parsePackageSpec("lodash");
      expect(result.source).toEqual({ type: "registry", name: "lodash" });
      expect(result.warnings).toEqual([]);
    });

    test("package with version", () => {
      const result = parsePackageSpec("lodash@^1.0.0");
      expect(result.source).toEqual({
        type: "registry",
        name: "lodash@^1.0.0",
      });
      expect(result.warnings).toEqual([]);
    });

    test("scoped package", () => {
      const result = parsePackageSpec("@org/code-review");
      expect(result.source).toEqual({
        type: "registry",
        name: "@org/code-review",
      });
      expect(result.warnings).toEqual([]);
    });

    test("scoped package with version", () => {
      const result = parsePackageSpec("@org/code-review@^2.0.0");
      expect(result.source).toEqual({
        type: "registry",
        name: "@org/code-review@^2.0.0",
      });
      expect(result.warnings).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // File/local paths
  // ---------------------------------------------------------------------------

  describe("file", () => {
    test("file: protocol", () => {
      const result = parsePackageSpec("file:./local-pkg");
      expect(result.source).toEqual({ type: "file", path: "./local-pkg" });
      expect(result.warnings).toEqual([]);
    });

    test("file: absolute path", () => {
      const result = parsePackageSpec("file:/absolute/path");
      expect(result.source).toEqual({ type: "file", path: "/absolute/path" });
      expect(result.warnings).toEqual([]);
    });

    test("relative path with ./", () => {
      const result = parsePackageSpec("./local-pkg");
      expect(result.source).toEqual({ type: "file", path: "./local-pkg" });
      expect(result.warnings).toEqual([]);
    });

    test("relative path with ../", () => {
      const result = parsePackageSpec("../sibling-pkg");
      expect(result.source).toEqual({ type: "file", path: "../sibling-pkg" });
      expect(result.warnings).toEqual([]);
    });

    test("absolute path", () => {
      const result = parsePackageSpec("/absolute/path/to/pkg");
      expect(result.source).toEqual({
        type: "file",
        path: "/absolute/path/to/pkg",
      });
      expect(result.warnings).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Git sources
  // ---------------------------------------------------------------------------

  describe("git", () => {
    test("github: protocol", () => {
      const result = parsePackageSpec("github:org/repo");
      expect(result.source).toEqual({
        type: "git",
        url: "github:org/repo",
      });
      expect(result.warnings).toEqual([]);
    });

    test("github: with ref", () => {
      const result = parsePackageSpec("github:org/repo#v1.0.0");
      expect(result.source).toEqual({
        type: "git",
        url: "github:org/repo",
        ref: "v1.0.0",
      });
      expect(result.warnings).toEqual([]);
    });

    test("https URL", () => {
      const result = parsePackageSpec("https://github.com/org/repo");
      expect(result.source).toEqual({
        type: "git",
        url: "https://github.com/org/repo",
      });
      expect(result.warnings).toEqual([]);
    });

    test("https URL with ref", () => {
      const result = parsePackageSpec("https://github.com/org/repo#main");
      expect(result.source).toEqual({
        type: "git",
        url: "https://github.com/org/repo",
        ref: "main",
      });
      expect(result.warnings).toEqual([]);
    });

    test("git+ssh URL", () => {
      const result = parsePackageSpec("git+ssh://git@github.com/org/repo");
      expect(result.source).toEqual({
        type: "git",
        url: "git+ssh://git@github.com/org/repo",
      });
      expect(result.warnings).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // GitHub shorthand
  // ---------------------------------------------------------------------------

  describe("GitHub shorthand", () => {
    test("org/repo interpreted as GitHub", () => {
      const result = parsePackageSpec("org/repo");
      expect(result.source).toEqual({
        type: "git",
        url: "github:org/repo",
      });
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("Interpreting");
      expect(result.warnings[0]).toContain("GitHub repo");
    });

    test("org/repo with ref", () => {
      const result = parsePackageSpec("org/repo#v2.0.0");
      expect(result.source).toEqual({
        type: "git",
        url: "github:org/repo",
        ref: "v2.0.0",
      });
      expect(result.warnings.length).toBe(1);
    });

    test("warning suggests scoped npm package", () => {
      const result = parsePackageSpec("myorg/my-pkg");
      expect(result.warnings[0]).toContain("@myorg/my-pkg");
    });
  });
});

// ---------------------------------------------------------------------------
// packageNameFromSource
// ---------------------------------------------------------------------------

describe("packageNameFromSource", () => {
  test("returns stripped name for registry source", () => {
    expect(packageNameFromSource({ type: "registry", name: "@org/pkg@^1.0.0" })).toBe("@org/pkg");
  });

  test("returns name as-is for registry source without version", () => {
    expect(packageNameFromSource({ type: "registry", name: "lodash" })).toBe("lodash");
  });

  test("throws for git source", () => {
    expect(() => packageNameFromSource({ type: "git", url: "github:org/repo" })).toThrow(
      "Cannot derive package name from git/file source",
    );
  });

  test("throws for file source", () => {
    expect(() => packageNameFromSource({ type: "file", path: "./local-pkg" })).toThrow(
      "Cannot derive package name from git/file source",
    );
  });
});

// ---------------------------------------------------------------------------
// getInstalledVersion
// ---------------------------------------------------------------------------

describe("getInstalledVersion", () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await createTempDir());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("returns version from valid package.json", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "2.3.4" }),
    );
    const version = await getInstalledVersion(dir);
    expect(version).toBe("2.3.4");
  });

  test("returns 'unknown' when version field is missing", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "test-pkg" }),
    );
    const version = await getInstalledVersion(dir);
    expect(version).toBe("unknown");
  });

  test("throws descriptive error when package.json does not exist", async () => {
    const nonExistent = join(dir, "no-such-dir");
    await expect(getInstalledVersion(nonExistent)).rejects.toThrow(
      `Failed to read package.json from ${nonExistent}`,
    );
  });

  test("throws descriptive error when package.json is corrupt", async () => {
    await writeFile(join(dir, "package.json"), "not valid json {{");
    await expect(getInstalledVersion(dir)).rejects.toThrow(
      `Failed to read package.json from ${dir}`,
    );
  });
});

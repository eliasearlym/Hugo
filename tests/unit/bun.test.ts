import { describe, test, expect } from "bun:test";
import { parsePackageSpec, packageNameFromSource } from "../../src/workflows/bun";
import type { PackageSource } from "../../src/workflows/types";

describe("parsePackageSpec", () => {
  test('"some-package" → registry source', () => {
    const result = parsePackageSpec("some-package");
    expect(result.source.type).toBe("registry");
    expect((result.source as { type: "registry"; name: string }).name).toBe("some-package");
  });

  test('"some-package@^1.0.0" → registry source with version', () => {
    const result = parsePackageSpec("some-package@^1.0.0");
    expect(result.source.type).toBe("registry");
    expect((result.source as { type: "registry"; name: string }).name).toBe("some-package@^1.0.0");
  });

  test('"@org/pkg" → registry source', () => {
    const result = parsePackageSpec("@org/pkg");
    expect(result.source.type).toBe("registry");
    expect((result.source as { type: "registry"; name: string }).name).toBe("@org/pkg");
  });

  test('"@org/pkg@^2.0.0" → registry source with version', () => {
    const result = parsePackageSpec("@org/pkg@^2.0.0");
    expect(result.source.type).toBe("registry");
    expect((result.source as { type: "registry"; name: string }).name).toBe("@org/pkg@^2.0.0");
  });

  test('"github:org/repo" → git source, no ref', () => {
    const result = parsePackageSpec("github:org/repo");
    expect(result.source.type).toBe("git");
    const source = result.source as { type: "git"; url: string; ref?: string };
    expect(source.url).toBe("github:org/repo");
    expect(source.ref).toBeUndefined();
  });

  test('"github:org/repo#v1.0.0" → git source with ref', () => {
    const result = parsePackageSpec("github:org/repo#v1.0.0");
    expect(result.source.type).toBe("git");
    const source = result.source as { type: "git"; url: string; ref?: string };
    expect(source.url).toBe("github:org/repo");
    expect(source.ref).toBe("v1.0.0");
  });

  test('"git+ssh://git@github.com:org/repo.git" → git source', () => {
    const result = parsePackageSpec("git+ssh://git@github.com:org/repo.git");
    expect(result.source.type).toBe("git");
  });

  test('"git+https://github.com/org/repo.git" → git source', () => {
    const result = parsePackageSpec("git+https://github.com/org/repo.git");
    expect(result.source.type).toBe("git");
  });

  test('"org/repo" → git source with github: prefix and warnings', () => {
    const result = parsePackageSpec("org/repo");
    expect(result.source.type).toBe("git");
    const source = result.source as { type: "git"; url: string; ref?: string };
    expect(source.url).toBe("github:org/repo");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('"org/repo#v1.0.0" → git source with ref and warnings', () => {
    const result = parsePackageSpec("org/repo#v1.0.0");
    expect(result.source.type).toBe("git");
    const source = result.source as { type: "git"; url: string; ref?: string };
    expect(source.ref).toBe("v1.0.0");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("packageNameFromSource", () => {
  test('registry source "pkg@^1.0.0" → returns "pkg"', () => {
    const source: PackageSource = { type: "registry", name: "pkg@^1.0.0" };
    expect(packageNameFromSource(source)).toBe("pkg");
  });

  test('registry source "@org/pkg@^1.0.0" → returns "@org/pkg"', () => {
    const source: PackageSource = { type: "registry", name: "@org/pkg@^1.0.0" };
    expect(packageNameFromSource(source)).toBe("@org/pkg");
  });

  test("git source → throws Error", () => {
    const source: PackageSource = { type: "git", url: "github:org/repo" };
    expect(() => packageNameFromSource(source)).toThrow(Error);
  });
});

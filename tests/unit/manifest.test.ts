import { describe, test, expect } from "bun:test";
import { parseManifest, ManifestError } from "../../src/workflows/manifest";

describe("parseManifest", () => {
  test("valid manifest with all fields parses correctly", () => {
    const input = JSON.stringify({
      name: "my-workflow",
      description: "A test workflow",
      agents: [{ path: "agents/helper.md" }],
      skills: [{ path: "skills/tool" }],
      commands: [{ path: "commands/run.md" }],
    });

    const result = parseManifest(input);

    expect(result.name).toBe("my-workflow");
    expect(result.description).toBe("A test workflow");
    expect(result.agents).toEqual([{ path: "agents/helper.md" }]);
    expect(result.skills).toEqual([{ path: "skills/tool" }]);
    expect(result.commands).toEqual([{ path: "commands/run.md" }]);
  });

  test("missing name throws ManifestError", () => {
    const input = JSON.stringify({
      description: "A test workflow",
    });

    expect(() => parseManifest(input)).toThrow(ManifestError);
  });

  test("empty name (whitespace only) throws ManifestError", () => {
    const input = JSON.stringify({
      name: "   ",
      description: "A test workflow",
    });

    expect(() => parseManifest(input)).toThrow(ManifestError);
  });

  test("missing description throws ManifestError", () => {
    const input = JSON.stringify({
      name: "my-workflow",
    });

    expect(() => parseManifest(input)).toThrow(ManifestError);
  });

  test("missing agents/skills/commands arrays defaults to empty arrays", () => {
    const input = JSON.stringify({
      name: "my-workflow",
      description: "A test workflow",
    });

    const result = parseManifest(input);

    expect(result.agents).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.commands).toEqual([]);
  });

  test("agent path without .md extension throws ManifestError", () => {
    const input = JSON.stringify({
      name: "my-workflow",
      description: "A test workflow",
      agents: [{ path: "agents/helper" }],
    });

    expect(() => parseManifest(input)).toThrow(ManifestError);
  });

  test("command path without .md extension throws ManifestError", () => {
    const input = JSON.stringify({
      name: "my-workflow",
      description: "A test workflow",
      commands: [{ path: "commands/run.txt" }],
    });

    expect(() => parseManifest(input)).toThrow(ManifestError);
  });

  test("skill path ending in .md throws ManifestError", () => {
    const input = JSON.stringify({
      name: "my-workflow",
      description: "A test workflow",
      skills: [{ path: "skills/tool.md" }],
    });

    expect(() => parseManifest(input)).toThrow(ManifestError);
  });

  test("absolute path throws ManifestError", () => {
    const input = JSON.stringify({
      name: "my-workflow",
      description: "A test workflow",
      agents: [{ path: "/etc/passwd.md" }],
    });

    expect(() => parseManifest(input)).toThrow(ManifestError);
  });

  test("path traversal throws ManifestError", () => {
    const input = JSON.stringify({
      name: "my-workflow",
      description: "A test workflow",
      agents: [{ path: "../../../etc/passwd.md" }],
    });

    expect(() => parseManifest(input)).toThrow(ManifestError);
  });

  test("non-array agents field throws ManifestError", () => {
    const input = JSON.stringify({
      name: "my-workflow",
      description: "A test workflow",
      agents: "not-an-array",
    });

    expect(() => parseManifest(input)).toThrow(ManifestError);
  });

  test("array item without path field throws ManifestError", () => {
    const input = JSON.stringify({
      name: "my-workflow",
      description: "A test workflow",
      agents: [{ name: "missing-path" }],
    });

    expect(() => parseManifest(input)).toThrow(ManifestError);
  });
});

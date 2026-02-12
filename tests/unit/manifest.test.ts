import { describe, test, expect } from "bun:test";
import { parseManifest, ManifestError } from "../../src/workflows/manifest";

describe("parseManifest", () => {
  // ---------------------------------------------------------------------------
  // Valid manifests
  // ---------------------------------------------------------------------------

  test("parses full manifest", () => {
    const result = parseManifest(
      JSON.stringify({
        agents: ["reviewer", "linter"],
        commands: ["review"],
        skills: ["analysis"],
      }),
    );
    expect(result).toEqual({
      agents: ["reviewer", "linter"],
      commands: ["review"],
      skills: ["analysis"],
      mcps: [],
    });
  });

  test("parses manifest with mcps", () => {
    const result = parseManifest(
      JSON.stringify({
        agents: ["reviewer"],
        commands: ["review"],
        skills: [],
        mcps: ["context7", "websearch"],
      }),
    );
    expect(result).toEqual({
      agents: ["reviewer"],
      commands: ["review"],
      skills: [],
      mcps: ["context7", "websearch"],
    });
  });

  test("defaults missing arrays to []", () => {
    const result = parseManifest("{}");
    expect(result).toEqual({ agents: [], commands: [], skills: [], mcps: [] });
  });

  test("handles partial manifest (agents only)", () => {
    const result = parseManifest(JSON.stringify({ agents: ["reviewer"] }));
    expect(result).toEqual({
      agents: ["reviewer"],
      commands: [],
      skills: [],
      mcps: [],
    });
  });

  test("handles null fields as missing", () => {
    const result = parseManifest(
      JSON.stringify({ agents: null, commands: null, skills: null, mcps: null }),
    );
    expect(result).toEqual({ agents: [], commands: [], skills: [], mcps: [] });
  });

  test("handles empty arrays", () => {
    const result = parseManifest(
      JSON.stringify({ agents: [], commands: [], skills: [], mcps: [] }),
    );
    expect(result).toEqual({ agents: [], commands: [], skills: [], mcps: [] });
  });

  // ---------------------------------------------------------------------------
  // Invalid JSON
  // ---------------------------------------------------------------------------

  test("throws ManifestError on invalid JSON", () => {
    expect(() => parseManifest("not json")).toThrow(ManifestError);
    expect(() => parseManifest("not json")).toThrow("Invalid JSON");
  });

  test("throws ManifestError when root is not an object", () => {
    expect(() => parseManifest('"string"')).toThrow("must be a JSON object");
    expect(() => parseManifest("[1,2]")).toThrow("must be a JSON object");
    expect(() => parseManifest("42")).toThrow("must be a JSON object");
    expect(() => parseManifest("null")).toThrow("must be a JSON object");
  });

  // ---------------------------------------------------------------------------
  // Invalid field types
  // ---------------------------------------------------------------------------

  test("throws when field is not an array", () => {
    expect(() =>
      parseManifest(JSON.stringify({ agents: "reviewer" })),
    ).toThrow("'agents' must be an array");

    expect(() =>
      parseManifest(JSON.stringify({ commands: 42 })),
    ).toThrow("'commands' must be an array");

    expect(() =>
      parseManifest(JSON.stringify({ skills: { a: 1 } })),
    ).toThrow("'skills' must be an array");
  });

  test("throws when array contains non-string", () => {
    expect(() =>
      parseManifest(JSON.stringify({ agents: [42] })),
    ).toThrow("agents[0] must be a string");

    expect(() =>
      parseManifest(JSON.stringify({ commands: ["ok", null] })),
    ).toThrow("commands[1] must be a string");
  });

  // ---------------------------------------------------------------------------
  // Empty strings
  // ---------------------------------------------------------------------------

  test("throws on empty string in array", () => {
    expect(() =>
      parseManifest(JSON.stringify({ agents: [""] })),
    ).toThrow("agents[0] must not be empty");

    expect(() =>
      parseManifest(JSON.stringify({ agents: ["reviewer", ""] })),
    ).toThrow("agents[1] must not be empty");
  });

  // ---------------------------------------------------------------------------
  // Duplicates
  // ---------------------------------------------------------------------------

  test("throws on duplicate name within a category", () => {
    expect(() =>
      parseManifest(JSON.stringify({ agents: ["reviewer", "reviewer"] })),
    ).toThrow('agents contains duplicate name: "reviewer"');
  });

  test("allows same name across different categories", () => {
    const result = parseManifest(
      JSON.stringify({
        agents: ["review"],
        commands: ["review"],
        skills: ["review"],
      }),
    );
    expect(result.agents).toEqual(["review"]);
    expect(result.commands).toEqual(["review"]);
    expect(result.skills).toEqual(["review"]);
  });
});

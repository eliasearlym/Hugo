import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createWebsearchConfig } from "../../src/mcp/websearch";
import { createBuiltinMcps } from "../../src/mcp/index";

/**
 * Unit tests for MCP configuration modules.
 *
 * - createWebsearchConfig: branching on provider, env var handling, error path.
 * - createBuiltinMcps: filtering via disabled array, provider forwarding.
 *
 * Static config exports (grep_app, context7) are pure data — not tested here.
 */

// -- Env var isolation --
// These functions read TAVILY_API_KEY, EXA_API_KEY, and CONTEXT7_API_KEY
// from process.env. Save and restore around each test to avoid pollution.

let savedEnv: Record<string, string | undefined>;

const ENV_KEYS = ["TAVILY_API_KEY", "EXA_API_KEY", "CONTEXT7_API_KEY"] as const;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
});

// ---------------------------------------------------------------------------
// createWebsearchConfig
// ---------------------------------------------------------------------------

describe("createWebsearchConfig", () => {
  test("defaults to exa provider", () => {
    const config = createWebsearchConfig();
    expect(config.type).toBe("remote");
    expect(config.url).toBe("https://mcp.exa.ai/mcp?tools=web_search_exa");
    expect(config.enabled).toBe(true);
    expect(config.oauth).toBe(false);
  });

  test("exa: no headers when EXA_API_KEY is unset", () => {
    const config = createWebsearchConfig("exa");
    expect(config.headers).toBeUndefined();
  });

  test("exa: includes x-api-key header when EXA_API_KEY is set", () => {
    process.env.EXA_API_KEY = "test-exa-key";
    const config = createWebsearchConfig("exa");
    expect(config.headers).toEqual({ "x-api-key": "test-exa-key" });
  });

  test("tavily: returns config with auth header when TAVILY_API_KEY is set", () => {
    process.env.TAVILY_API_KEY = "test-tavily-key";
    const config = createWebsearchConfig("tavily");
    expect(config.type).toBe("remote");
    expect(config.url).toBe("https://mcp.tavily.com/mcp/");
    expect(config.enabled).toBe(true);
    expect(config.oauth).toBe(false);
    expect(config.headers).toEqual({
      Authorization: "Bearer test-tavily-key",
    });
  });

  test("tavily: throws when TAVILY_API_KEY is unset", () => {
    expect(() => createWebsearchConfig("tavily")).toThrow(
      "TAVILY_API_KEY environment variable is required for Tavily provider",
    );
  });
});

// ---------------------------------------------------------------------------
// createBuiltinMcps
// ---------------------------------------------------------------------------

describe("createBuiltinMcps", () => {
  test("returns all 3 MCPs by default", () => {
    const mcps = createBuiltinMcps();
    expect(Object.keys(mcps).sort()).toEqual(["context7", "grep_app", "websearch"]);
  });

  test("each default MCP has type 'remote' and enabled true", () => {
    const mcps = createBuiltinMcps();
    for (const [, config] of Object.entries(mcps)) {
      expect(config.type).toBe("remote");
      expect(config.enabled).toBe(true);
    }
  });

  test("disabling one MCP excludes it", () => {
    const mcps = createBuiltinMcps({ disabled: ["websearch"] });
    expect(Object.keys(mcps).sort()).toEqual(["context7", "grep_app"]);
    expect(mcps.websearch).toBeUndefined();
  });

  test("disabling multiple MCPs excludes all of them", () => {
    const mcps = createBuiltinMcps({ disabled: ["websearch", "context7"] });
    expect(Object.keys(mcps)).toEqual(["grep_app"]);
  });

  test("disabling all MCPs returns empty object", () => {
    const mcps = createBuiltinMcps({
      disabled: ["websearch", "context7", "grep_app"],
    });
    expect(mcps).toEqual({});
  });

  test("forwards websearchProvider to createWebsearchConfig", () => {
    process.env.TAVILY_API_KEY = "test-tavily-key";
    const mcps = createBuiltinMcps({ websearchProvider: "tavily" });
    expect(mcps.websearch.url).toBe("https://mcp.tavily.com/mcp/");
    expect(mcps.websearch.headers).toEqual({
      Authorization: "Bearer test-tavily-key",
    });
  });
});

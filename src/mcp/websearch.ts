import type { McpRemoteConfig } from "@opencode-ai/sdk";

export type WebsearchProvider = "exa" | "tavily";

export function createWebsearchConfig(
  provider: WebsearchProvider = "exa",
): McpRemoteConfig {
  if (provider === "tavily") {
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!tavilyKey) {
      throw new Error(
        "TAVILY_API_KEY environment variable is required for Tavily provider",
      );
    }

    return {
      type: "remote",
      url: "https://mcp.tavily.com/mcp/",
      enabled: true,
      headers: {
        Authorization: `Bearer ${tavilyKey}`,
      },
      oauth: false,
    };
  }

  return {
    type: "remote",
    url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
    enabled: true,
    headers: process.env.EXA_API_KEY
      ? { "x-api-key": process.env.EXA_API_KEY }
      : undefined,
    oauth: false,
  };
}

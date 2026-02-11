import type { McpRemoteConfig } from "@opencode-ai/sdk";

export const context7: McpRemoteConfig = {
  type: "remote",
  url: "https://mcp.context7.com/mcp",
  enabled: true,
  headers: process.env.CONTEXT7_API_KEY
    ? { Authorization: `Bearer ${process.env.CONTEXT7_API_KEY}` }
    : undefined,
  oauth: false,
};

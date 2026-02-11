import type { McpRemoteConfig } from "@opencode-ai/sdk";
import { createWebsearchConfig, type WebsearchProvider } from "./websearch";
import { context7 } from "./context7";
import { grep_app } from "./grep_app";

export type McpName = "websearch" | "context7" | "grep_app";

export interface BuiltinMcpOptions {
  disabled?: McpName[];
  websearchProvider?: WebsearchProvider;
}

export function createBuiltinMcps(
  options: BuiltinMcpOptions = {},
): Record<string, McpRemoteConfig> {
  const { disabled = [], websearchProvider } = options;
  const mcps: Record<string, McpRemoteConfig> = {};

  if (!disabled.includes("websearch")) {
    mcps.websearch = createWebsearchConfig(websearchProvider);
  }

  if (!disabled.includes("context7")) {
    mcps.context7 = context7;
  }

  if (!disabled.includes("grep_app")) {
    mcps.grep_app = grep_app;
  }

  return mcps;
}

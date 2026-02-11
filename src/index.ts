import type { Plugin } from "@opencode-ai/plugin";
import { createBuiltinMcps } from "./mcp";

export const HugoPlugin: Plugin = async (ctx) => {
  return {
    config: async (config) => {
      const mcps = createBuiltinMcps();
      config.mcp = {
        ...mcps,
        ...config.mcp,
      };
    },
  };
};

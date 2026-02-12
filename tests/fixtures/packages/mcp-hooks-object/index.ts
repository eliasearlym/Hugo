export default {
  config: async (config: Record<string, unknown>) => {
    config.mcp = {
      ...config.mcp as object,
      "grep-app": {
        type: "remote",
        url: "https://grep.app/mcp",
      },
    };
  },
};

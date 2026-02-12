export default async (ctx: unknown) => ({
  config: async (config: Record<string, unknown>) => {
    config.mcp = {
      ...config.mcp as object,
      context7: {
        type: "remote",
        url: "https://mcp.context7.com/mcp",
      },
      websearch: {
        type: "remote",
        url: "https://search.example.com/mcp",
      },
    };
  },
});

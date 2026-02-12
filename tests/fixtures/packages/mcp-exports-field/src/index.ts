export default async (ctx: unknown) => ({
  config: async (config: Record<string, unknown>) => {
    config.mcp = {
      ...config.mcp as object,
      "exports-mcp": {
        type: "remote",
        url: "https://exports.example.com/mcp",
      },
    };
  },
});

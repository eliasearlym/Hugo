// This plugin calls ctx.client during init, which will throw via deep proxy
export default async (ctx: any) => {
  // Calling a function on the proxy triggers the error
  const tools = await ctx.client.api.listTools();
  return {
    config: async (config: Record<string, unknown>) => {
      config.mcp = { "some-server": { type: "remote", url: "https://example.com" } };
    },
  };
};

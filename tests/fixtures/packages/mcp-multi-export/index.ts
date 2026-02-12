// Helper function — NOT the plugin
export function helperUtil() {
  return "I'm a helper";
}

// Another helper
export function formatStuff() {
  return "formatted";
}

// The actual plugin — name ends with "Plugin"
export async function myWorkflowPlugin(ctx: unknown) {
  return {
    config: async (config: Record<string, unknown>) => {
      config.mcp = {
        ...config.mcp as object,
        "multi-mcp": {
          type: "remote",
          url: "https://multi.example.com/mcp",
        },
      };
    },
  };
}

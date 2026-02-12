import { describe, test, expect } from "bun:test";
import { stripVersion, deriveWorkflowName } from "../../src/workflows/utils";

describe("stripVersion", () => {
  test("unscoped package without version", () => {
    expect(stripVersion("lodash")).toBe("lodash");
  });

  test("unscoped package with version", () => {
    expect(stripVersion("lodash@^1.0.0")).toBe("lodash");
  });

  test("scoped package without version", () => {
    expect(stripVersion("@org/pkg")).toBe("@org/pkg");
  });

  test("scoped package with version", () => {
    expect(stripVersion("@org/pkg@^2.0.0")).toBe("@org/pkg");
  });

  test("scoped package with exact version", () => {
    expect(stripVersion("@org/pkg@1.2.3")).toBe("@org/pkg");
  });

  test("package with complex version range", () => {
    expect(stripVersion("pkg@>=1.0.0 <2.0.0")).toBe("pkg");
  });
});

describe("deriveWorkflowName", () => {
  test("strips scope from scoped package", () => {
    expect(deriveWorkflowName("@org/code-review")).toBe("code-review");
  });

  test("strips scope from any org", () => {
    expect(deriveWorkflowName("@happily-dev/debugging")).toBe("debugging");
  });

  test("passes through unscoped name", () => {
    expect(deriveWorkflowName("code-review")).toBe("code-review");
  });

  test("handles single-word unscoped name", () => {
    expect(deriveWorkflowName("testing")).toBe("testing");
  });

  test("handles scope-only edge case (no slash)", () => {
    // Malformed, but shouldn't crash
    expect(deriveWorkflowName("@org")).toBe("@org");
  });
});

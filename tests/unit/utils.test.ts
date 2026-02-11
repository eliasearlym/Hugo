import { describe, test, expect } from "bun:test";
import { stripVersion } from "../../src/workflows/utils";

describe("stripVersion", () => {
  test('"pkg" → "pkg"', () => {
    expect(stripVersion("pkg")).toBe("pkg");
  });

  test('"pkg@^1.0.0" → "pkg"', () => {
    expect(stripVersion("pkg@^1.0.0")).toBe("pkg");
  });

  test('"@org/pkg" → "@org/pkg"', () => {
    expect(stripVersion("@org/pkg")).toBe("@org/pkg");
  });

  test('"@org/pkg@^1.0.0" → "@org/pkg"', () => {
    expect(stripVersion("@org/pkg@^1.0.0")).toBe("@org/pkg");
  });

  test('"@org/pkg@latest" → "@org/pkg"', () => {
    expect(stripVersion("@org/pkg@latest")).toBe("@org/pkg");
  });
});

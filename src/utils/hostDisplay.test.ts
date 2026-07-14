import { describe, expect, it } from "vitest";
import { formatHostName } from "./hostDisplay";

describe("formatHostName", () => {
  it("uses the Union product label without changing other worker IDs", () => {
    expect(formatHostName("union-inesctec")).toBe("Union INESC TEC");
    expect(formatHostName("server")).toBe("server");
  });

  it("normalizes empty values", () => {
    expect(formatHostName(undefined)).toBe("-");
    expect(formatHostName("  ")).toBe("-");
  });
});

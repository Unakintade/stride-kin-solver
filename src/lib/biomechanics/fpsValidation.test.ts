import { describe, it, expect } from "vitest";
import { validateFps } from "./fpsValidation";

describe("validateFps", () => {
  it("rejects zero FPS", () => {
    const result = validateFps(0, null);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
  });

  it("warns on low FPS", () => {
    const result = validateFps(30, null);
    expect(result.ok).toBe(true);
    expect(result.severity).toBe("warn");
  });

  it("info on moderate FPS", () => {
    const result = validateFps(60, null);
    expect(result.ok).toBe(true);
    expect(result.severity).toBe("info");
  });

  it("no warning at 120+ FPS", () => {
    const result = validateFps(120, null);
    expect(result.ok).toBe(true);
    expect(result.severity).toBe("none");
  });

  it("warns on mismatch with metadata", () => {
    const result = validateFps(30, 120);
    expect(result.ok).toBe(true);
    expect(result.severity).toBe("warn");
    expect(result.warning).toContain("differs significantly");
  });

  it("no mismatch warning when close", () => {
    const result = validateFps(120, 119);
    expect(result.severity).toBe("none");
  });
});

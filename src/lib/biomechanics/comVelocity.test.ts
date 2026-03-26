import { describe, it, expect } from "vitest";
import { velocityFromPositionTrack } from "./comVelocity";

describe("velocityFromPositionTrack", () => {
  it("matches constant velocity with central difference at interior", () => {
    const fps = 10;
    const positions: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ];
    const timestamps = [0, 0.1, 0.2, 0.3];
    const v = velocityFromPositionTrack(positions, timestamps, fps, 2);
    expect(v[0]).toBeCloseTo(10, 5);
    expect(v[1]).toBe(0);
    expect(v[2]).toBe(0);
  });
});

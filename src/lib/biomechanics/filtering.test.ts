import { describe, it, expect } from "vitest";
import { smoothLandmarks } from "./filtering";
import type { FrameLandmarks } from "./types";
import { MOCAP_TARGET_LANDMARKS } from "./constants";

function makeFrame(
  frameIdx: number,
  worldZ: number,
  visibility = 1
): FrameLandmarks {
  const positions = Array.from({ length: 33 }, () => [0, 0, 0]);
  const worldPositions = Array.from({ length: 33 }, () => [0, 0, 0]);
  const vis = Array(33).fill(visibility);
  for (const idx of Object.values(MOCAP_TARGET_LANDMARKS)) {
    worldPositions[idx] = [0, 0, worldZ];
  }
  return {
    frameIdx,
    timestamp: frameIdx / 30,
    positions,
    worldPositions,
    visibility: vis,
  };
}

describe("smoothLandmarks", () => {
  it("RTS mode runs without throwing on a short sequence", () => {
    const frames: FrameLandmarks[] = [];
    for (let i = 0; i < 15; i++) {
      frames.push(makeFrame(i, i * 0.01 + (i % 3) * 0.001));
    }
    const out = smoothLandmarks(frames, 30, undefined, { useRtsSmoother: true });
    expect(out).toHaveLength(15);
    expect(out[7].worldPositions[11][2]).toBeFinite();
  });

  it("forward-only mode matches length", () => {
    const frames = [makeFrame(0, 0), makeFrame(1, 0.1), makeFrame(2, 0.2)];
    const out = smoothLandmarks(frames, 60, undefined, { useRtsSmoother: false });
    expect(out).toHaveLength(3);
  });
});

import { describe, it, expect } from "vitest";
import { computeKinematics } from "@/lib/biomechanics/kinematics";
import type { FrameLandmarks } from "@/lib/biomechanics/types";

function makeFrame(kneeInteriorAngleDeg: number): FrameLandmarks {
  const positions = Array.from({ length: 33 }, () => [0, 0, 0]);
  const worldPositions = Array.from({ length: 33 }, () => [0, 0, 0]);
  const visibility = Array(33).fill(1);
  const radians = (kneeInteriorAngleDeg * Math.PI) / 180;

  worldPositions[23] = [-1, 0, 0];
  worldPositions[25] = [0, 0, 0];
  worldPositions[27] = [Math.cos(radians), Math.sin(radians), 0];
  worldPositions[24] = [-1, 0, 0];
  worldPositions[26] = [0, 0, 0];
  worldPositions[28] = [Math.cos(radians), Math.sin(radians), 0];

  return {
    frameIdx: 0,
    timestamp: 0,
    positions,
    worldPositions,
    visibility,
  };
}

describe("computeKinematics", () => {
  it("reports knee extension using the clinical deficit convention", () => {
    const [result] = computeKinematics([makeFrame(115)], 30);
    const leftKnee = result.jointAngles.find((joint) => joint.name === "Left Knee Extension");

    expect(leftKnee?.angleDeg).toBeCloseTo(65, 4);
  });
});

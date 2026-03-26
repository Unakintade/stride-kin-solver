/**
 * Dev / advanced debugging: per-frame minimum visibility for each tracked joint.
 */

import type { FrameLandmarks } from "./types";
import { minVisibility } from "./visibility";

/** Joint definitions matching kinematics.ts JOINT_DEFINITIONS ordering. */
const DEBUG_JOINTS: { name: string; landmarks: number[] }[] = [
  { name: "L Shoulder", landmarks: [23, 11, 13] },
  { name: "R Shoulder", landmarks: [24, 12, 14] },
  { name: "L Elbow", landmarks: [11, 13, 15] },
  { name: "R Elbow", landmarks: [12, 14, 16] },
  { name: "L Hip", landmarks: [11, 23, 25] },
  { name: "R Hip", landmarks: [12, 24, 26] },
  { name: "L Knee", landmarks: [23, 25, 27] },
  { name: "R Knee", landmarks: [24, 26, 28] },
  { name: "L Ankle", landmarks: [25, 27, 31] },
  { name: "R Ankle", landmarks: [26, 28, 32] },
];

export interface PerFrameVisibility {
  frameIdx: number;
  timestamp: number;
  joints: Record<string, number>;
}

/**
 * Generate a per-frame, per-joint minimum visibility report.
 * Useful for identifying frames/joints with tracking problems.
 */
export function dumpVisibilityReport(
  landmarks: FrameLandmarks[]
): PerFrameVisibility[] {
  return landmarks.map((fl) => {
    const joints: Record<string, number> = {};
    for (const j of DEBUG_JOINTS) {
      joints[j.name] = minVisibility(fl, j.landmarks);
    }
    return {
      frameIdx: fl.frameIdx,
      timestamp: fl.timestamp,
      joints,
    };
  });
}

/**
 * Summarise visibility as CSV string (for console/file export).
 */
export function visibilityReportCSV(report: PerFrameVisibility[]): string {
  if (report.length === 0) return "";
  const jointNames = Object.keys(report[0].joints);
  const header = ["frame", "timestamp", ...jointNames].join(",");
  const rows = report.map((r) =>
    [r.frameIdx, r.timestamp.toFixed(4), ...jointNames.map((n) => r.joints[n].toFixed(3))].join(",")
  );
  return [header, ...rows].join("\n");
}

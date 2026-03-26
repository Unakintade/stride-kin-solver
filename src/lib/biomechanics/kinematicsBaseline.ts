import type { FrameLandmarks, FrameResult, JointAngle } from "./types";
import { IK_LANDMARKS, LIMB_SEGMENTS, JOINT_VELOCITY_LIMITS } from "./constants";

/**
 * Calculate joint angle between three points (in degrees).
 */
function angleBetween(a: number[], b: number[], c: number[]): number {
  const ba = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const bc = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const dot = ba[0] * bc[0] + ba[1] * bc[1] + ba[2] * bc[2];
  const magBA = Math.sqrt(ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2);
  const magBC = Math.sqrt(bc[0] ** 2 + bc[1] ** 2 + bc[2] ** 2);
  if (magBA < 1e-8 || magBC < 1e-8) return 0;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

function dist3(a: number[], b: number[]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

const JOINT_DEFINITIONS: { name: string; landmarks: [number, number, number]; limitKey: string }[] = [
  { name: "Left Shoulder Flexion", landmarks: [23, 11, 13], limitKey: "shoulder_flexion" },
  { name: "Right Shoulder Flexion", landmarks: [24, 12, 14], limitKey: "shoulder_flexion" },
  { name: "Left Elbow Flexion", landmarks: [11, 13, 15], limitKey: "elbow_flexion" },
  { name: "Right Elbow Flexion", landmarks: [12, 14, 16], limitKey: "elbow_flexion" },
  { name: "Left Hip Flexion", landmarks: [11, 23, 25], limitKey: "hip_flexion" },
  { name: "Right Hip Flexion", landmarks: [12, 24, 26], limitKey: "hip_flexion" },
  { name: "Left Knee Extension", landmarks: [23, 25, 27], limitKey: "knee_extension" },
  { name: "Right Knee Extension", landmarks: [24, 26, 28], limitKey: "knee_extension" },
  { name: "Left Ankle Flexion", landmarks: [25, 27, 31], limitKey: "ankle_plantarflexion" },
  { name: "Right Ankle Flexion", landmarks: [26, 28, 32], limitKey: "ankle_plantarflexion" },
];

function toReportedJointAngle(name: string, rawAngleDeg: number): number {
  if (name.includes("Knee Extension")) {
    return Math.max(0, 180 - rawAngleDeg);
  }

  return rawAngleDeg;
}

/**
 * Compute kinematic results from smoothed landmarks.
 */
export function computeKinematicsBaseline(
  landmarks: FrameLandmarks[],
  fps: number,
  onProgress?: (progress: number) => void
): FrameResult[] {
  const results: FrameResult[] = [];
  const dt = 1 / fps;

  for (let i = 0; i < landmarks.length; i++) {
    const fl = landmarks[i];
    const wp = fl.worldPositions;
    const warnings: string[] = [];

    // Joint angles
    const jointAngles: JointAngle[] = JOINT_DEFINITIONS.map((jd) => {
      const angle = toReportedJointAngle(
        jd.name,
        angleBetween(wp[jd.landmarks[0]], wp[jd.landmarks[1]], wp[jd.landmarks[2]])
      );

      // Angular velocity via finite difference
      let velocity = 0;
      if (i > 0) {
        const prevWp = landmarks[i - 1].worldPositions;
        const prevAngle = toReportedJointAngle(
          jd.name,
          angleBetween(
            prevWp[jd.landmarks[0]], prevWp[jd.landmarks[1]], prevWp[jd.landmarks[2]]
          )
        );
        velocity = ((angle - prevAngle) * Math.PI) / (180 * dt);

        // Sanity check
        const limit = JOINT_VELOCITY_LIMITS[jd.limitKey] ?? JOINT_VELOCITY_LIMITS.default;
        if (Math.abs(velocity) > limit) {
          warnings.push(
            `${jd.name}: ${Math.abs(velocity).toFixed(1)} rad/s exceeds limit ${limit} rad/s`
          );
        }
      }

      return { name: jd.name, angleDeg: angle, velocityRadS: velocity, confidence: 1 };
    });

    // Stride length (ankle-to-ankle distance)
    const strideLength = dist3(wp[27], wp[28]);

    // Center of mass (approximate as midpoint of hips)
    const comPosition: [number, number, number] = [
      (wp[23][0] + wp[24][0]) / 2,
      (wp[23][1] + wp[24][1]) / 2,
      (wp[23][2] + wp[24][2]) / 2,
    ];

    // CoM velocity
    let comVelocity: [number, number, number] = [0, 0, 0];
    if (i > 0) {
      const prevResult = results[i - 1];
      comVelocity = [
        (comPosition[0] - prevResult.comPosition[0]) / dt,
        (comPosition[1] - prevResult.comPosition[1]) / dt,
        (comPosition[2] - prevResult.comPosition[2]) / dt,
      ];
    }

    results.push({
      timestamp: fl.timestamp,
      frameIdx: fl.frameIdx,
      jointAngles,
      strideLength,
      comPosition,
      comVelocity,
      warnings,
    });

    onProgress?.((i + 1) / landmarks.length);
  }

  return results;
}

export { computeKinematicsBaseline as computeKinematics };

/**
 * Compute anthropometric measurements from landmarks.
 */
export function computeAnthropometry(
  landmarks: FrameLandmarks[],
  nFrames: number = 10
): Record<string, number> {
  const n = Math.min(nFrames, landmarks.length);
  const measurements: Record<string, number[]> = {};

  for (const [segName, [idxA, idxB]] of Object.entries(LIMB_SEGMENTS)) {
    measurements[segName] = [];
  }

  for (let i = 0; i < n; i++) {
    const wp = landmarks[i].worldPositions;
    for (const [segName, [idxA, idxB]] of Object.entries(LIMB_SEGMENTS)) {
      const length = dist3(wp[idxA], wp[idxB]);
      if (length > 0.01) measurements[segName].push(length);
    }
  }

  const avgLengths: Record<string, number> = {};
  for (const [segName, lengths] of Object.entries(measurements)) {
    if (lengths.length > 0) {
      avgLengths[segName] = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    }
  }

  return avgLengths;
}

/**
 * Export results as CSV string.
 */
export function exportCSV(results: FrameResult[]): string {
  if (results.length === 0) return "";

  const jointNames = results[0].jointAngles.map((j) => j.name);

  const headers = [
    "timestamp",
    ...jointNames.map((n) => `${n}_angle_deg`),
    ...jointNames.map((n) => `${n}_vel_rad_s`),
    "stride_length_m",
    "com_x", "com_y", "com_z",
    "com_vel_x", "com_vel_y", "com_vel_z",
  ];

  const rows = results.map((r) => [
    r.timestamp.toFixed(4),
    ...r.jointAngles.map((j) => j.angleDeg.toFixed(4)),
    ...r.jointAngles.map((j) => j.velocityRadS.toFixed(4)),
    r.strideLength.toFixed(4),
    ...r.comPosition.map((v) => v.toFixed(4)),
    ...r.comVelocity.map((v) => v.toFixed(4)),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

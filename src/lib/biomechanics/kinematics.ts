import type { FrameLandmarks, FrameResult, JointAngle } from "./types";
import { LIMB_SEGMENTS, JOINT_VELOCITY_LIMITS } from "./constants";
import { landmarksVisible, minVisibility, interpolateGatedAngles, DEFAULT_VISIBILITY_THRESHOLD } from "./visibility";
import { type Mat3, applyHomography } from "./homography";

/** Calibrate normalized image coordinates to meters using a known horizontal span (e.g. track markings). */
export interface MetricCalibrationInput {
  /** Meters represented by the full normalized horizontal extent (0→1 across frame width). */
  fieldWidthMeters: number;
  videoWidthPx: number;
  videoHeightPx: number;
}

export interface ComputeKinematicsOptions {
  metricCalibration?: MetricCalibrationInput | null;
  /** 3×3 homography matrix mapping normalised image coords to ground-plane metres. */
  homography?: Mat3 | null;
  /** Minimum landmark visibility to trust a joint angle (default 0.65). */
  visibilityThreshold?: number;
}

/**
 * Calculate joint angle between three 3D points (in degrees).
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

function dist2(a: number[], b: number[]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
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

/**
 * Estimate a pixels-to-meters scale factor by comparing world-space segment
 * lengths to their image-space equivalents, averaged over the first N frames.
 */
function estimateScaleFactor(landmarks: FrameLandmarks[], nFrames = 20): number {
  const n = Math.min(nFrames, landmarks.length);
  const ratios: number[] = [];

  // Use reliable long segments: thighs and shanks
  const segments: [number, number][] = [[23, 25], [24, 26], [25, 27], [26, 28]];

  for (let i = 0; i < n; i++) {
    const wp = landmarks[i].worldPositions;
    const ip = landmarks[i].positions;
    for (const [a, b] of segments) {
      const worldDist = dist3(wp[a], wp[b]);
      const imageDist = dist2(ip[a], ip[b]); // normalized 0-1 coords
      if (worldDist > 0.05 && imageDist > 0.01) {
        ratios.push(worldDist / imageDist);
      }
    }
  }

  if (ratios.length === 0) return 1;
  // Use median for robustness
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)];
}

/**
 * Detect heel-strike events using ankle vertical position (image-space Y).
 * A heel strike occurs when the ankle Y reaches a local maximum (lowest point
 * in image space where Y increases downward) AND is relatively stationary.
 * Returns arrays of frame indices for left and right heel strikes.
 */
function detectHeelStrikes(
  landmarks: FrameLandmarks[],
  fps: number
): { left: number[]; right: number[] } {
  const windowHalf = Math.max(2, Math.round(fps * 0.04)); // ~40ms window

  const leftAnkleY = landmarks.map((fl) => fl.positions[27][1]);
  const rightAnkleY = landmarks.map((fl) => fl.positions[28][1]);

  function findLocalMaxima(signal: number[]): number[] {
    const peaks: number[] = [];
    for (let i = windowHalf; i < signal.length - windowHalf; i++) {
      let isPeak = true;
      for (let j = i - windowHalf; j <= i + windowHalf; j++) {
        if (j !== i && signal[j] > signal[i]) {
          isPeak = false;
          break;
        }
      }
      if (isPeak) {
        // Only accept if the Y value is in the lower portion of the range (foot near ground)
        const min = Math.min(...signal);
        const max = Math.max(...signal);
        const range = max - min;
        if (range > 0.01 && signal[i] > min + range * 0.6) {
          peaks.push(i);
        }
      }
    }
    return peaks;
  }

  return {
    left: findLocalMaxima(leftAnkleY),
    right: findLocalMaxima(rightAnkleY),
  };
}

/**
 * Compute stride lengths from heel-strike events.
 * Stride = distance traveled by the hip midpoint (in scaled image space)
 * between two consecutive heel strikes of the same foot.
 */
function computeStrideLengths(
  landmarks: FrameLandmarks[],
  heelStrikes: { left: number[]; right: number[] },
  scaleX: number,
  scaleY: number
): Map<number, number> {
  const strideLengthMap = new Map<number, number>();

  function processStrikes(strikes: number[]) {
    for (let s = 1; s < strikes.length; s++) {
      const startFrame = strikes[s - 1];
      const endFrame = strikes[s];

      // Compute cumulative hip displacement between consecutive strikes
      let totalDisplacement = 0;
      for (let f = startFrame + 1; f <= endFrame; f++) {
        const prevHipX = (landmarks[f - 1].positions[23][0] + landmarks[f - 1].positions[24][0]) / 2;
        const prevHipY = (landmarks[f - 1].positions[23][1] + landmarks[f - 1].positions[24][1]) / 2;
        const currHipX = (landmarks[f].positions[23][0] + landmarks[f].positions[24][0]) / 2;
        const currHipY = (landmarks[f].positions[23][1] + landmarks[f].positions[24][1]) / 2;
        const dx = currHipX - prevHipX;
        const dy = currHipY - prevHipY;
        totalDisplacement += Math.sqrt((dx * scaleX) ** 2 + (dy * scaleY) ** 2);
      }

      const strideMeters = totalDisplacement;

      // Assign this stride length to all frames in the stride
      for (let f = startFrame; f <= endFrame; f++) {
        strideLengthMap.set(f, strideMeters);
      }
    }
  }

  processStrikes(heelStrikes.left);
  processStrikes(heelStrikes.right);

  return strideLengthMap;
}

/**
 * Compute kinematic results from smoothed landmarks (geometric joint angles — not MuJoCo IK).
 */
export function computeKinematics(
  landmarks: FrameLandmarks[],
  fps: number,
  onProgress?: (progress: number) => void,
  options?: ComputeKinematicsOptions
): FrameResult[] {
  const results: FrameResult[] = [];
  const dt = 1 / fps;

  const cal = options?.metricCalibration;
  let scaleX: number;
  let scaleY: number;
  if (
    cal &&
    cal.fieldWidthMeters > 0 &&
    cal.videoWidthPx > 0 &&
    cal.videoHeightPx > 0
  ) {
    scaleX = cal.fieldWidthMeters;
    scaleY = cal.fieldWidthMeters * (cal.videoHeightPx / cal.videoWidthPx);
  } else {
    const scale = estimateScaleFactor(landmarks);
    scaleX = scale;
    scaleY = scale;
  }

  // Detect gait events for stride computation
  const heelStrikes = detectHeelStrikes(landmarks, fps);
  const strideLengthMap = computeStrideLengths(landmarks, heelStrikes, scaleX, scaleY);

  for (let i = 0; i < landmarks.length; i++) {
    const fl = landmarks[i];
    const wp = fl.worldPositions;
    const ip = fl.positions;
    const warnings: string[] = [];

    // Joint angles (use world positions for angular measurements — they're accurate)
    const jointAngles: JointAngle[] = JOINT_DEFINITIONS.map((jd) => {
      const angle = angleBetween(wp[jd.landmarks[0]], wp[jd.landmarks[1]], wp[jd.landmarks[2]]);

      let velocity = 0;
      if (i > 0) {
        const prevWp = landmarks[i - 1].worldPositions;
        const prevAngle = angleBetween(
          prevWp[jd.landmarks[0]], prevWp[jd.landmarks[1]], prevWp[jd.landmarks[2]]
        );
        velocity = ((angle - prevAngle) * Math.PI) / (180 * dt);

        const limit = JOINT_VELOCITY_LIMITS[jd.limitKey] ?? JOINT_VELOCITY_LIMITS.default;
        if (Math.abs(velocity) > limit) {
          warnings.push(
            `${jd.name}: ${Math.abs(velocity).toFixed(1)} rad/s exceeds limit ${limit} rad/s`
          );
        }
      }

      return { name: jd.name, angleDeg: angle, velocityRadS: velocity };
    });

    // Stride length from gait events (or 0 if no stride detected yet)
    const strideLength = strideLengthMap.get(i) ?? 0;

    // CoM position from image-space hip midpoint, scaled to meters
    const comImageX = (ip[23][0] + ip[24][0]) / 2;
    const comImageY = (ip[23][1] + ip[24][1]) / 2;
    // World Z (depth) from world positions is still useful for the depth axis
    const comWorldZ = (wp[23][2] + wp[24][2]) / 2;

    const comPosition: [number, number, number] = [
      comImageX * scaleX,
      comImageY * scaleY,
      comWorldZ,
    ];

    // CoM velocity via finite difference on scaled image positions
    let comVelocity: [number, number, number] = [0, 0, 0];
    if (i > 0) {
      const prev = results[i - 1];
      comVelocity = [
        (comPosition[0] - prev.comPosition[0]) / dt,
        (comPosition[1] - prev.comPosition[1]) / dt,
        (comPosition[2] - prev.comPosition[2]) / dt,
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

/**
 * Compute anthropometric measurements from landmarks.
 */
export function computeAnthropometry(
  landmarks: FrameLandmarks[],
  nFrames: number = 10
): Record<string, number> {
  const n = Math.min(nFrames, landmarks.length);
  const measurements: Record<string, number[]> = {};

  for (const segName of Object.keys(LIMB_SEGMENTS)) {
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
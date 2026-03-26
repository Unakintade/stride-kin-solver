import type { FrameLandmarks, FrameResult, JointAngle } from "./types";
import { LIMB_SEGMENTS, JOINT_VELOCITY_LIMITS, MAX_COM_SPEED_MS, SYMMETRIC_LIMB_PAIRS } from "./constants";
import { landmarksVisible, minVisibility, interpolateGatedAngles, DEFAULT_VISIBILITY_THRESHOLD } from "./visibility";
import { type Mat3, applyHomography } from "./homography";
import { smartDeriv } from "./derivatives";

/** Calibrate normalized image coordinates to meters using a known horizontal span (e.g. track markings). */
export interface MetricCalibrationInput {
  /** Meters represented by the full normalized horizontal extent (0→1 across frame width). */
  fieldWidthMeters: number;
  videoWidthPx: number;
  videoHeightPx: number;
}

/**
 * How to handle frames where landmark visibility falls below threshold.
 * - `"interpolate"` — linearly interpolate across gaps (default, legacy behaviour).
 * - `"hold-last"`  — hold the last valid value; no synthetic data injected.
 * - `"nan"`        — mark as NaN and emit a warning; downstream charts will show a gap.
 */
export type GatingMode = "interpolate" | "hold-last" | "nan";

export interface ComputeKinematicsOptions {
  metricCalibration?: MetricCalibrationInput | null;
  /** 3×3 homography matrix mapping normalised image coords to ground-plane metres. */
  homography?: Mat3 | null;
  /** Minimum landmark visibility to trust a joint angle (default 0.65). */
  visibilityThreshold?: number;
  /**
   * How to handle gated (low-visibility) frames.
   * @default "interpolate"
   */
  gatingMode?: GatingMode;
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
  const segments: [number, number][] = [[23, 25], [24, 26], [25, 27], [26, 28]];

  for (let i = 0; i < n; i++) {
    const wp = landmarks[i].worldPositions;
    const ip = landmarks[i].positions;
    for (const [a, b] of segments) {
      const worldDist = dist3(wp[a], wp[b]);
      const imageDist = dist2(ip[a], ip[b]);
      if (worldDist > 0.05 && imageDist > 0.01) {
        ratios.push(worldDist / imageDist);
      }
    }
  }

  if (ratios.length === 0) return 1;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)];
}

/**
 * Detect heel-strike events using ankle vertical position (image-space Y).
 */
function detectHeelStrikes(
  landmarks: FrameLandmarks[],
  fps: number
): { left: number[]; right: number[] } {
  const windowHalf = Math.max(2, Math.round(fps * 0.04));

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
 * Compute stride lengths using an arbitrary image→metre mapping function.
 */
function computeStrideLengthsH(
  landmarks: FrameLandmarks[],
  heelStrikes: { left: number[]; right: number[] },
  toMetric: (x: number, y: number) => [number, number]
): Map<number, number> {
  const strideLengthMap = new Map<number, number>();

  function processStrikes(strikes: number[]) {
    for (let s = 1; s < strikes.length; s++) {
      const startFrame = strikes[s - 1];
      const endFrame = strikes[s];

      let totalDisplacement = 0;
      for (let f = startFrame + 1; f <= endFrame; f++) {
        const prevHipX = (landmarks[f - 1].positions[23][0] + landmarks[f - 1].positions[24][0]) / 2;
        const prevHipY = (landmarks[f - 1].positions[23][1] + landmarks[f - 1].positions[24][1]) / 2;
        const currHipX = (landmarks[f].positions[23][0] + landmarks[f].positions[24][0]) / 2;
        const currHipY = (landmarks[f].positions[23][1] + landmarks[f].positions[24][1]) / 2;
        const [px, py] = toMetric(prevHipX, prevHipY);
        const [cx, cy] = toMetric(currHipX, currHipY);
        totalDisplacement += Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
      }

      for (let f = startFrame; f <= endFrame; f++) {
        strideLengthMap.set(f, totalDisplacement);
      }
    }
  }

  processStrikes(heelStrikes.left);
  processStrikes(heelStrikes.right);

  return strideLengthMap;
}

/**
 * Apply gating strategy to a raw angle series.
 *
 * - `"interpolate"` — linear interpolation across gaps (existing behaviour).
 * - `"hold-last"` — carry forward the last valid reading.
 * - `"nan"` — leave as NaN; will appear as gaps in charts.
 */
function applyGating(raw: (number | null)[], mode: GatingMode): number[] {
  if (mode === "interpolate") return interpolateGatedAngles(raw);

  if (mode === "hold-last") {
    const out: number[] = new Array(raw.length);
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== null) last = raw[i]!;
      out[i] = last;
    }
    return out;
  }

  // "nan" mode
  return raw.map((v) => (v === null ? NaN : v));
}

/**
 * Compute kinematic results from forward-Kalman landmarks.
 *
 * Uses central differences (or Savitzky–Golay when ≥ 5 frames) for angular
 * velocity instead of a backward-only finite difference. This produces
 * smoother, more symmetric velocity estimates without the phase lag of a
 * purely causal derivative.
 *
 * Knobs (via constants.ts):
 *  - KF_PROCESS_NOISE_STD  — Kalman process noise; higher = more responsive, noisier.
 *  - KF_BASE_MEASUREMENT_NOISE — base measurement uncertainty before visibility scaling.
 *  - FPS (dt = 1/fps) — MUST match the real capture frame rate or velocities will be wrong.
 */
export function computeKinematics(
  landmarks: FrameLandmarks[],
  fps: number,
  onProgress?: (progress: number) => void,
  options?: ComputeKinematicsOptions
): FrameResult[] {
  const results: FrameResult[] = [];
  const dt = 1 / fps;
  const visThresh = options?.visibilityThreshold ?? DEFAULT_VISIBILITY_THRESHOLD;
  const gatingMode = options?.gatingMode ?? "interpolate";
  const H = options?.homography ?? null;

  const cal = options?.metricCalibration;
  let scaleX: number;
  let scaleY: number;
  if (H) {
    scaleX = 1;
    scaleY = 1;
  } else if (
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

  function toMetric(imgX: number, imgY: number): [number, number] {
    if (H) return applyHomography(H, imgX, imgY);
    return [imgX * scaleX, imgY * scaleY];
  }

  // Detect gait events for stride computation
  const heelStrikes = detectHeelStrikes(landmarks, fps);
  const strideLengthMap = computeStrideLengthsH(landmarks, heelStrikes, toMetric);

  // ── First pass: compute raw angles (or null if gated) ──
  const rawAnglesPerJoint: (number | null)[][] = JOINT_DEFINITIONS.map(() => []);

  for (let i = 0; i < landmarks.length; i++) {
    const fl = landmarks[i];
    const wp = fl.worldPositions;

    for (let j = 0; j < JOINT_DEFINITIONS.length; j++) {
      const jd = JOINT_DEFINITIONS[j];
      const vis = landmarksVisible(fl, jd.landmarks, visThresh);
      if (vis) {
        rawAnglesPerJoint[j].push(
          angleBetween(wp[jd.landmarks[0]], wp[jd.landmarks[1]], wp[jd.landmarks[2]])
        );
      } else {
        rawAnglesPerJoint[j].push(null);
      }
    }
  }

  // Apply selected gating strategy
  const gatedAngles: number[][] = rawAnglesPerJoint.map((series) =>
    applyGating(series, gatingMode)
  );

  // ── Compute angular velocities via central diff / SG ──
  // Convert to radians, differentiate, then store in rad/s.
  const velocitiesPerJoint: number[][] = gatedAngles.map((angleDegSeries, j) => {
    const angleRadSeries = angleDegSeries.map((a) => (a * Math.PI) / 180);
    const rawVel = smartDeriv(angleRadSeries, dt);

    // Clamp to physiological limits
    const limit = JOINT_VELOCITY_LIMITS[JOINT_DEFINITIONS[j].limitKey] ?? JOINT_VELOCITY_LIMITS.default;
    return rawVel.map((v) => {
      if (Math.abs(v) > limit) return Math.sign(v) * limit;
      return v;
    });
  });

  // ── Track which frames had clamped velocities for warnings ──
  const clampedFrames: Map<number, string[]> = new Map();
  gatedAngles.forEach((angleDegSeries, j) => {
    const angleRadSeries = angleDegSeries.map((a) => (a * Math.PI) / 180);
    const rawVel = smartDeriv(angleRadSeries, dt);
    const limit = JOINT_VELOCITY_LIMITS[JOINT_DEFINITIONS[j].limitKey] ?? JOINT_VELOCITY_LIMITS.default;
    for (let i = 0; i < rawVel.length; i++) {
      if (Math.abs(rawVel[i]) > limit) {
        const existing = clampedFrames.get(i) ?? [];
        existing.push(
          `${JOINT_DEFINITIONS[j].name}: velocity clamped from ${Math.abs(rawVel[i]).toFixed(1)} to ${limit} rad/s (artifact)`
        );
        clampedFrames.set(i, existing);
      }
    }
  });

  // ── Second pass: assemble results ──
  for (let i = 0; i < landmarks.length; i++) {
    const fl = landmarks[i];
    const ip = fl.positions;
    const wp = fl.worldPositions;
    const warnings: string[] = [...(clampedFrames.get(i) ?? [])];

    const jointAngles: JointAngle[] = JOINT_DEFINITIONS.map((jd, j) => {
      const angle = gatedAngles[j][i];
      const conf = minVisibility(fl, jd.landmarks);
      const velocity = velocitiesPerJoint[j][i];

      if (isNaN(angle)) {
        warnings.push(`${jd.name}: gated (NaN) — visibility too low`);
      } else if (conf < visThresh) {
        warnings.push(
          `${jd.name}: low visibility (${(conf * 100).toFixed(0)}%) — ${gatingMode === "interpolate" ? "interpolated" : gatingMode === "hold-last" ? "held last" : "NaN"}`
        );
      }

      return { name: jd.name, angleDeg: angle, velocityRadS: velocity, confidence: conf };
    });

    // Stride length
    const strideLength = strideLengthMap.get(i) ?? 0;

    // CoM position
    const comImageX = (ip[23][0] + ip[24][0]) / 2;
    const comImageY = (ip[23][1] + ip[24][1]) / 2;
    const [comX, comY] = toMetric(comImageX, comImageY);
    const comWorldZ = (wp[23][2] + wp[24][2]) / 2;
    const comPosition: [number, number, number] = [comX, comY, comWorldZ];

    // CoM velocity via central diff (computed inline for 3 axes)
    let comVelocity: [number, number, number] = [0, 0, 0];
    if (landmarks.length >= 2) {
      // Use central diff for CoM too
      const prevIdx = Math.max(0, i - 1);
      const nextIdx = Math.min(landmarks.length - 1, i + 1);
      const prevIp = landmarks[prevIdx].positions;
      const nextIp = landmarks[nextIdx].positions;
      const prevWp = landmarks[prevIdx].worldPositions;
      const nextWp = landmarks[nextIdx].worldPositions;

      const [prevX, prevY] = toMetric(
        (prevIp[23][0] + prevIp[24][0]) / 2,
        (prevIp[23][1] + prevIp[24][1]) / 2
      );
      const [nextX, nextY] = toMetric(
        (nextIp[23][0] + nextIp[24][0]) / 2,
        (nextIp[23][1] + nextIp[24][1]) / 2
      );
      const prevZ = (prevWp[23][2] + prevWp[24][2]) / 2;
      const nextZ = (nextWp[23][2] + nextWp[24][2]) / 2;

      const span = (nextIdx - prevIdx) * dt;
      const rawComVel: [number, number, number] = [
        (nextX - prevX) / span,
        (nextY - prevY) / span,
        (nextZ - prevZ) / span,
      ];

      const comSpeed = Math.sqrt(rawComVel[0] ** 2 + rawComVel[1] ** 2 + rawComVel[2] ** 2);
      if (comSpeed > MAX_COM_SPEED_MS) {
        const scale = MAX_COM_SPEED_MS / comSpeed;
        comVelocity = [rawComVel[0] * scale, rawComVel[1] * scale, rawComVel[2] * scale];
        warnings.push(
          `CoM speed clamped from ${comSpeed.toFixed(1)} to ${MAX_COM_SPEED_MS} m/s (artifact)`
        );
      } else {
        comVelocity = rawComVel;
      }
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

  // Symmetrize paired limbs to mitigate monocular perspective distortion
  for (const [leftKey, rightKey] of SYMMETRIC_LIMB_PAIRS) {
    if (avgLengths[leftKey] != null && avgLengths[rightKey] != null) {
      const mean = (avgLengths[leftKey] + avgLengths[rightKey]) / 2;
      avgLengths[leftKey] = mean;
      avgLengths[rightKey] = mean;
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
    ...jointNames.map((n) => `${n}_confidence`),
    "stride_length_m",
    "com_x", "com_y", "com_z",
    "com_vel_x", "com_vel_y", "com_vel_z",
  ];

  const rows = results.map((r) => [
    r.timestamp.toFixed(4),
    ...r.jointAngles.map((j) => j.angleDeg.toFixed(4)),
    ...r.jointAngles.map((j) => j.velocityRadS.toFixed(4)),
    ...r.jointAngles.map((j) => j.confidence.toFixed(3)),
    r.strideLength.toFixed(4),
    ...r.comPosition.map((v) => v.toFixed(4)),
    ...r.comVelocity.map((v) => v.toFixed(4)),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

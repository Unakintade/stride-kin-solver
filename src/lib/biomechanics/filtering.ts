import type { FrameLandmarks } from "./types";
import {
  KF_PROCESS_NOISE_STD,
  KF_BASE_MEASUREMENT_NOISE,
  KF_MIN_VISIBILITY,
  MOCAP_TARGET_LANDMARKS,
} from "./constants";

type Vec3 = [number, number, number];
type Mat3 = number[][];

function buildF(dt: number): Mat3 {
  const dt2 = dt * dt;
  return [
    [1, dt, 0.5 * dt2],
    [0, 1, dt],
    [0, 0, 1],
  ];
}

function buildQ(dt: number, processNoiseStd: number): Mat3 {
  const q = processNoiseStd ** 2;
  const dt2 = dt * dt;
  const dt3 = dt ** 3;
  const dt4 = dt ** 4;
  const dt5 = dt ** 5;
  return [
    [q * dt5 / 20, q * dt4 / 8, q * dt3 / 6],
    [q * dt4 / 8, q * dt3 / 3, q * dt2 / 2],
    [q * dt3 / 6, q * dt2 / 2, q * dt],
  ];
}

function matMul3(A: Mat3, B: Mat3): Mat3 {
  const C: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) C[i][j] += A[i][k] * B[k][j];
  return C;
}

function transpose3(A: Mat3): Mat3 {
  return [
    [A[0][0], A[1][0], A[2][0]],
    [A[0][1], A[1][1], A[2][1]],
    [A[0][2], A[1][2], A[2][2]],
  ];
}

function matAdd3(A: Mat3, B: Mat3): Mat3 {
  return A.map((row, i) => row.map((v, j) => v + B[i][j])) as Mat3;
}

function matVec3(A: Mat3, v: Vec3): Vec3 {
  return [
    A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
    A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
    A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2],
  ];
}

/** 3×3 inverse; returns null if singular. */
function inv3x3(M: Mat3): Mat3 | null {
  const a = M[0][0],
    b = M[0][1],
    c = M[0][2];
  const d = M[1][0],
    e = M[1][1],
    f = M[1][2];
  const g = M[2][0],
    h = M[2][1],
    i = M[2][2];
  const det =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-18) return null;
  const s = 1 / det;
  return [
    [(e * i - f * h) * s, (c * h - b * i) * s, (b * f - c * e) * s],
    [(f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s],
    [(d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s],
  ];
}

function caPredict(x: Vec3, P: Mat3, F: Mat3, Q: Mat3): { xPred: Vec3; PPred: Mat3 } {
  const xPred = matVec3(F, x) as Vec3;
  const FP = matMul3(F, P);
  const FT = transpose3(F);
  const PPred = matAdd3(matMul3(FP, FT), Q);
  return { xPred, PPred };
}

function caUpdate(xPred: Vec3, PPred: Mat3, z: number, R: number): { x: Vec3; P: Mat3 } {
  const S = PPred[0][0] + R;
  const K: Vec3 = [PPred[0][0] / S, PPred[1][0] / S, PPred[2][0] / S];
  const y = z - xPred[0];
  const x: Vec3 = [
    xPred[0] + K[0] * y,
    xPred[1] + K[1] * y,
    xPred[2] + K[2] * y,
  ];
  const P: Mat3 = PPred.map((row, i) =>
    row.map((val, j) => val - K[i] * PPred[0][j])
  ) as Mat3;
  return { x, P };
}

function predictNextFromFiltered(
  xFilt: Vec3,
  PFilt: Mat3,
  F: Mat3,
  Q: Mat3
): { xNext: Vec3; PNext: Mat3 } {
  const { xPred, PPred } = caPredict(xFilt, PFilt, F, Q);
  return { xNext: xPred, PNext: PPred };
}

/**
 * Rauch–Tung–Striebel backward pass for constant-acceleration model (offline smoothing).
 */
function rtsBackward(
  xFilt: Vec3[],
  PFilt: Mat3[],
  xPredNext: Vec3[],
  PPredNext: Mat3[],
  F: Mat3
): Vec3[] {
  const N = xFilt.length;
  if (N === 0) return [];
  const xSmooth: Vec3[] = new Array(N);
  xSmooth[N - 1] = [...xFilt[N - 1]] as Vec3;

  const FT = transpose3(F);

  for (let k = N - 2; k >= 0; k--) {
    const Pp = PPredNext[k];
    const invPp = inv3x3(Pp);
    if (!invPp) {
      xSmooth[k] = [...xFilt[k]] as Vec3;
      continue;
    }
    const C = matMul3(matMul3(PFilt[k], FT), invPp);
    const diff: Vec3 = [
      xSmooth[k + 1][0] - xPredNext[k][0],
      xSmooth[k + 1][1] - xPredNext[k][1],
      xSmooth[k + 1][2] - xPredNext[k][2],
    ];
    const correction = matVec3(C, diff) as Vec3;
    xSmooth[k] = [
      xFilt[k][0] + correction[0],
      xFilt[k][1] + correction[1],
      xFilt[k][2] + correction[2],
    ];
  }

  return xSmooth;
}

type AxisSeries = {
  xFilt: Vec3[];
  PFilt: Mat3[];
  xPredNext: Vec3[];
  PPredNext: Mat3[];
};

function emptySeries(n: number): AxisSeries {
  return {
    xFilt: new Array(n),
    PFilt: new Array(n),
    xPredNext: new Array(n),
    PPredNext: new Array(n),
  };
}

export interface SmoothLandmarksOptions {
  /**
   * Use RTS smoothing on the forward Kalman estimates (recommended for offline video).
   */
  useRtsSmoother?: boolean;
}

export interface SmoothLandmarksResult {
  /** RTS-smoothed landmarks — visually smooth, best for skeleton overlay. */
  smoothed: FrameLandmarks[];
  /** Forward-only Kalman landmarks — preserves sharper transients for derivatives/kinematics. */
  forward: FrameLandmarks[];
}

/**
 * Smooth world landmark positions with a constant-acceleration Kalman filter per axis,
 * optionally followed by an RTS smoother for non-causal refinement.
 */
export function smoothLandmarks(
  landmarks: FrameLandmarks[],
  fps: number,
  onProgress?: (progress: number) => void,
  options?: SmoothLandmarksOptions
): SmoothLandmarksResult {
  const useRts = options?.useRtsSmoother !== false;
  if (landmarks.length === 0) return { smoothed: [], forward: [] };

  const N = landmarks.length;
  const dt = 1 / fps;
  const F = buildF(dt);
  const Q = buildQ(dt, KF_PROCESS_NOISE_STD);
  const indices = Object.values(MOCAP_TARGET_LANDMARKS);

  const series: Record<number, Record<number, AxisSeries>> = {};
  for (const idx of indices) {
    series[idx] = {
      0: emptySeries(N),
      1: emptySeries(N),
      2: emptySeries(N),
    };
  }

  type State = { x: Vec3; P: Mat3 };
  const state: Record<string, State> = {};

  for (const idx of indices) {
    for (let axis = 0; axis < 3; axis++) {
      const z0 = landmarks[0].worldPositions[idx][axis];
      state[`${idx}-${axis}`] = {
        x: [z0, 0, 0],
        P: [
          [10, 0, 0],
          [0, 10, 0],
          [0, 0, 10],
        ],
      };
    }
  }

  for (let f = 0; f < N; f++) {
    const fl = landmarks[f];
    for (const idx of indices) {
      for (let axis = 0; axis < 3; axis++) {
        const key = `${idx}-${axis}`;
        let { x, P } = state[key];
        const vis = Math.max(fl.visibility[idx], KF_MIN_VISIBILITY);
        const R = (KF_BASE_MEASUREMENT_NOISE / vis) ** 2;
        const z = fl.worldPositions[idx][axis];

        const { xPred, PPred } = caPredict(x, P, F, Q);
        const up = caUpdate(xPred, PPred, z, R);

        series[idx][axis].xFilt[f] = up.x;
        series[idx][axis].PFilt[f] = up.P;

        if (f < N - 1) {
          const next = predictNextFromFiltered(up.x, up.P, F, Q);
          series[idx][axis].xPredNext[f] = next.xNext;
          series[idx][axis].PPredNext[f] = next.PNext;
        }

        state[key] = { x: up.x, P: up.P };
      }
    }
    onProgress?.((f + 1) / (useRts ? 2 * N : N));
  }

  // Helper to clone landmark frames
  const cloneFrames = (): FrameLandmarks[] =>
    landmarks.map((fl) => ({
      frameIdx: fl.frameIdx,
      timestamp: fl.timestamp,
      positions: fl.positions.map((row) => [...row]),
      worldPositions: fl.worldPositions.map((row) => [...row]),
      visibility: [...fl.visibility],
    }));

  // Forward-only Kalman output (sharper transients for kinematics / derivatives)
  const forward = cloneFrames();
  for (const idx of indices) {
    for (let axis = 0; axis < 3; axis++) {
      const s = series[idx][axis];
      for (let f = 0; f < N; f++) {
        forward[f].worldPositions[idx][axis] = s.xFilt[f][0];
      }
    }
  }

  // RTS-smoothed output (smooth skeleton for visualization)
  const smoothed = cloneFrames();
  for (const idx of indices) {
    for (let axis = 0; axis < 3; axis++) {
      const s = series[idx][axis];
      const smoothedStates = useRts
        ? rtsBackward(s.xFilt, s.PFilt, s.xPredNext, s.PPredNext, F)
        : s.xFilt;

      for (let f = 0; f < N; f++) {
        smoothed[f].worldPositions[idx][axis] = smoothedStates[f][0];
      }
    }
  }

  if (useRts) {
    for (let f = 0; f < N; f++) {
      onProgress?.((N + f + 1) / (2 * N));
    }
  }

  return { smoothed, forward };
}

import type { FrameLandmarks } from "./types";
import {
  KF_PROCESS_NOISE_STD,
  KF_BASE_MEASUREMENT_NOISE,
  KF_MIN_VISIBILITY,
  IK_LANDMARKS,
} from "./constants";

/**
 * Simple 1D Constant-Acceleration Kalman Filter.
 * State: [position, velocity, acceleration]
 */
class KalmanFilter1D {
  x: number[]; // state [pos, vel, acc]
  P: number[][]; // covariance 3x3
  dt: number;
  processNoiseStd: number;

  constructor(dt: number, processNoiseStd: number) {
    this.dt = dt;
    this.processNoiseStd = processNoiseStd;
    this.x = [0, 0, 0];
    this.P = [
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10],
    ];
  }

  predict(): void {
    const dt = this.dt;
    const dt2 = dt * dt;

    // State transition
    const newX = [
      this.x[0] + this.x[1] * dt + 0.5 * this.x[2] * dt2,
      this.x[1] + this.x[2] * dt,
      this.x[2],
    ];

    // F matrix
    const F = [
      [1, dt, 0.5 * dt2],
      [0, 1, dt],
      [0, 0, 1],
    ];

    // Process noise
    const q = this.processNoiseStd ** 2;
    const dt3 = dt ** 3;
    const dt4 = dt ** 4;
    const dt5 = dt ** 5;
    const Q = [
      [q * dt5 / 20, q * dt4 / 8, q * dt3 / 6],
      [q * dt4 / 8, q * dt3 / 3, q * dt2 / 2],
      [q * dt3 / 6, q * dt2 / 2, q * dt],
    ];

    // P = F * P * F^T + Q
    const FP = matMul3(F, this.P);
    const FT = transpose3(F);
    const FPFT = matMul3(FP, FT);
    this.P = matAdd3(FPFT, Q);
    this.x = newX;
  }

  update(measurement: number, R: number): void {
    // H = [1, 0, 0]
    const S = this.P[0][0] + R;
    const K = [this.P[0][0] / S, this.P[1][0] / S, this.P[2][0] / S];
    const y = measurement - this.x[0];

    this.x = [
      this.x[0] + K[0] * y,
      this.x[1] + K[1] * y,
      this.x[2] + K[2] * y,
    ];

    // P = (I - K*H) * P
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        this.P[i][j] -= K[i] * this.P[0][j];
      }
    }
  }
}

function matMul3(A: number[][], B: number[][]): number[][] {
  const C = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        C[i][j] += A[i][k] * B[k][j];
  return C;
}

function transpose3(A: number[][]): number[][] {
  return [[A[0][0],A[1][0],A[2][0]],[A[0][1],A[1][1],A[2][1]],[A[0][2],A[1][2],A[2][2]]];
}

function matAdd3(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

/**
 * Smooth landmarks using a bank of Kalman filters.
 */
export function smoothLandmarks(
  landmarks: FrameLandmarks[],
  fps: number,
  onProgress?: (progress: number) => void
): FrameLandmarks[] {
  if (landmarks.length === 0) return [];

  const dt = 1 / fps;
  const filters: Record<number, KalmanFilter1D[]> = {};

  // Initialize filters for IK landmarks
  for (const [, idx] of Object.entries(IK_LANDMARKS)) {
    filters[idx] = [
      new KalmanFilter1D(dt, KF_PROCESS_NOISE_STD),
      new KalmanFilter1D(dt, KF_PROCESS_NOISE_STD),
      new KalmanFilter1D(dt, KF_PROCESS_NOISE_STD),
    ];
    // Initialize with first frame
    for (let axis = 0; axis < 3; axis++) {
      filters[idx][axis].x[0] = landmarks[0].worldPositions[idx][axis];
    }
  }

  const smoothed: FrameLandmarks[] = [];

  for (let f = 0; f < landmarks.length; f++) {
    const fl = landmarks[f];
    const newWorld = fl.worldPositions.map((row) => [...row]);

    for (const [idxStr, kfAxes] of Object.entries(filters)) {
      const idx = Number(idxStr);
      const vis = Math.max(fl.visibility[idx], KF_MIN_VISIBILITY);
      const adaptiveR = (KF_BASE_MEASUREMENT_NOISE / vis) ** 2;

      for (let axis = 0; axis < 3; axis++) {
        kfAxes[axis].predict();
        kfAxes[axis].update(fl.worldPositions[idx][axis], adaptiveR);
        newWorld[idx][axis] = kfAxes[axis].x[0];
      }
    }

    smoothed.push({
      frameIdx: fl.frameIdx,
      timestamp: fl.timestamp,
      positions: fl.positions.map((row) => [...row]),
      worldPositions: newWorld,
      visibility: [...fl.visibility],
    });

    onProgress?.((f + 1) / landmarks.length);
  }

  return smoothed;
}

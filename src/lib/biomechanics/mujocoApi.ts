/**
 * Client for the MuJoCo physics backend.
 * Sends smoothed landmarks and receives enriched kinetic data
 * (joint torques, GRFs, CoM) from mj_inverse.
 */

import type { FrameLandmarks } from "./types";

export interface MuJoCoJointResult {
  angle_deg: number;
  velocity_rad_s: number;
  torque_nm: number;
}

export interface MuJoCoFrameResult {
  timestamp: number;
  frame_idx: number;
  joints: Record<string, MuJoCoJointResult>;
  com_position: [number, number, number];
  com_velocity: [number, number, number];
  grf_left: [number, number, number];
  grf_right: [number, number, number];
  residual_error: number;
  warnings: string[];
}

export interface MuJoCoSolveResponse {
  frames: MuJoCoFrameResult[];
  summary: {
    total_frames: number;
    solve_time_s: number;
    mean_residual_m: number;
    max_residual_m: number;
    total_warnings: number;
    fps: number;
  };
}

const DEFAULT_BACKEND_URL = "https://biomech-worker.onrender.com";

export function getMuJoCoBackendUrl(): string {
  return localStorage.getItem("mujoco_backend_url") || DEFAULT_BACKEND_URL;
}

export function setMuJoCoBackendUrl(url: string): void {
  localStorage.setItem("mujoco_backend_url", url);
}

export async function checkMuJoCoHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getMuJoCoBackendUrl()}/health`, {
      signal: AbortSignal.timeout(30000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function solveMuJoCo(
  landmarks: FrameLandmarks[],
  fps: number,
  anthropometry?: Record<string, number>,
  onProgress?: (progress: number) => void,
  weightKg?: number,
): Promise<MuJoCoSolveResponse> {
  const url = getMuJoCoBackendUrl();

  onProgress?.(0.05);

  const payload = {
    landmarks: landmarks.map((lm) => ({
      frameIdx: lm.frameIdx,
      timestamp: lm.timestamp,
      worldPositions: lm.worldPositions,
      visibility: lm.visibility,
    })),
    fps,
    weight_kg: weightKg ?? 75,
    anthropometry: anthropometry && Object.keys(anthropometry).length > 0
      ? anthropometry
      : undefined,
  };

  onProgress?.(0.1);

  const res = await fetch(`${url}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MuJoCo backend error (${res.status}): ${err}`);
  }

  onProgress?.(0.95);
  const data: MuJoCoSolveResponse = await res.json();
  onProgress?.(1.0);

  return data;
}

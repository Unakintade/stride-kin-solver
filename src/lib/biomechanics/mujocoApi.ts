/**
 * Client for the MuJoCo physics backend.
 * Sends smoothed landmarks and receives enriched kinetic data.
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
  /** Raw JSON from the backend, always preserved for debugging */
  _raw: Record<string, unknown>;
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

/**
 * Normalise whatever the backend returns into MuJoCoSolveResponse.
 * If the response already has `frames`, use it directly.
 * If it has `joint_angles` / `vertical_forces` (flat array format), convert.
 */
function normaliseResponse(raw: Record<string, unknown>): MuJoCoSolveResponse {
  // Already in the expected format
  if (Array.isArray(raw.frames)) {
    return {
      frames: raw.frames as MuJoCoFrameResult[],
      summary: (raw.summary ?? {
        total_frames: (raw.frames as unknown[]).length,
        solve_time_s: 0,
        mean_residual_m: 0,
        max_residual_m: 0,
        total_warnings: 0,
        fps: 0,
      }) as MuJoCoSolveResponse["summary"],
      _raw: raw,
    };
  }

  // Flat-array format from backend: { joint_angles: number[], vertical_forces: number[], summary: {...} }
  const jointAngles = (raw.joint_angles ?? []) as number[];
  const verticalForces = (raw.vertical_forces ?? []) as number[];
  const rawSummary = (raw.summary ?? {}) as Record<string, unknown>;
  const framesProcessed = Number(rawSummary.frames_processed ?? jointAngles.length ?? 0);

  const frames: MuJoCoFrameResult[] = Array.from({ length: framesProcessed }, (_, i) => ({
    timestamp: 0,
    frame_idx: i,
    joints: {
      knee: {
        angle_deg: jointAngles[i] ?? 0,
        velocity_rad_s: 0,
        torque_nm: 0,
      },
    },
    com_position: [0, 0, 0],
    com_velocity: [0, 0, 0],
    grf_left: [0, 0, 0],
    grf_right: [0, verticalForces[i] ?? 0, 0],
    residual_error: 0,
    warnings: [],
  }));

  return {
    frames,
    summary: {
      total_frames: framesProcessed,
      solve_time_s: 0,
      mean_residual_m: 0,
      max_residual_m: 0,
      total_warnings: 0,
      fps: 0,
    },
    _raw: raw,
  };
}

export async function solveMuJoCo(
  landmarks: FrameLandmarks[],
  fps: number,
  anthropometry?: Record<string, number>,
  onProgress?: (progress: number) => void,
  weightKg?: number,
  heightCm?: number,
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
    height_cm: heightCm,
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
  const data = await res.json();
  onProgress?.(1.0);

  return normaliseResponse(data);
}

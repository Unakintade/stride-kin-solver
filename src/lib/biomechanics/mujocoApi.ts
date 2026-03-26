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

const defaultSummary = (
  n: number,
  patch?: Partial<MuJoCoSolveResponse["summary"]>,
): MuJoCoSolveResponse["summary"] => ({
  total_frames: patch?.total_frames ?? n,
  solve_time_s: patch?.solve_time_s ?? 0,
  mean_residual_m: patch?.mean_residual_m ?? 0,
  max_residual_m: patch?.max_residual_m ?? 0,
  total_warnings: patch?.total_warnings ?? 0,
  fps: patch?.fps ?? 0,
});

/** biomech-worker style: segment blocks, no top-level `joints` */
function isLandmarkKineticsFrame(f: unknown): boolean {
  if (!f || typeof f !== "object") return false;
  const o = f as Record<string, unknown>;
  if (o.joints != null && typeof o.joints === "object") return false;
  return o.pelvis != null && typeof o.pelvis === "object";
}

function mag3(av: unknown): number {
  if (!Array.isArray(av)) return 0;
  if (av.length >= 3) {
    return Math.sqrt(Number(av[0]) ** 2 + Number(av[1]) ** 2 + Number(av[2]) ** 2);
  }
  if (av.length >= 2) return Math.hypot(Number(av[0]), Number(av[1]));
  if (av.length === 1) return Math.abs(Number(av[0]));
  return 0;
}

function mapLandmarkKineticsFrame(raw: Record<string, unknown>, i: number): MuJoCoFrameResult {
  const jointFromSeg = (name: string): MuJoCoJointResult | null => {
    const s = raw[name];
    if (!s || typeof s !== "object") return null;
    const seg = s as { orientation?: number[]; angular_velocity?: unknown };
    const ori = seg.orientation ?? [0, 0];
    const ω = mag3(seg.angular_velocity);
    return {
      angle_deg: Number(ori[0]) ?? 0,
      velocity_rad_s: ω,
      torque_nm: 0,
    };
  };

  const joints: Record<string, MuJoCoJointResult> = {};
  for (const name of ["pelvis", "thigh", "shank", "foot"]) {
    const j = jointFromSeg(name);
    if (j) joints[name] = j;
  }

  const vf = Number(raw.vertical_force ?? 0);
  const fy = Math.max(0, vf) / 2;

  const gL = raw.grf_left as number[] | undefined;
  const gR = raw.grf_right as number[] | undefined;
  const grf_left: [number, number, number] =
    gL?.length === 3 ? [gL[0], gL[1], gL[2]] : [0, fy, 0];
  const grf_right: [number, number, number] =
    gR?.length === 3 ? [gR[0], gR[1], gR[2]] : [0, fy, 0];

  const com = (raw.com_position as number[] | undefined) ?? [0, 0, 0];
  const cv = (raw.com_velocity as number[] | undefined) ?? [0, 0, 0];

  return {
    timestamp: Number(raw.timestamp ?? 0),
    frame_idx: Number(raw.frame_idx ?? i),
    joints,
    com_position: [com[0] ?? 0, com[1] ?? 0, com[2] ?? 0],
    com_velocity: [cv[0] ?? 0, cv[1] ?? 0, cv[2] ?? 0],
    grf_left,
    grf_right,
    residual_error: Number(raw.residual_error ?? 0),
    warnings: Array.isArray(raw.warnings) ? (raw.warnings as string[]) : [],
  };
}

/**
 * Normalise whatever the backend returns into MuJoCoSolveResponse.
 * If the response already has `frames`, use it directly.
 * If it has `joint_angles` / `vertical_forces` (flat array format), convert.
 */
function normaliseResponse(raw: Record<string, unknown>): MuJoCoSolveResponse {
  if (Array.isArray(raw.frames) && raw.frames.length > 0) {
    const first = raw.frames[0] as unknown;
    if (isLandmarkKineticsFrame(first)) {
      const frames = (raw.frames as Record<string, unknown>[]).map((fr, i) =>
        mapLandmarkKineticsFrame(fr, i),
      );
      const s = (raw.summary ?? {}) as Partial<MuJoCoSolveResponse["summary"]>;
      return {
        frames,
        summary: defaultSummary(frames.length, s),
        _raw: raw,
      };
    }
    return {
      frames: raw.frames as MuJoCoFrameResult[],
      summary: defaultSummary((raw.frames as unknown[]).length, raw.summary as Partial<
        MuJoCoSolveResponse["summary"]
      >),
      _raw: raw,
    };
  }

  if (Array.isArray(raw.frames) && (raw.frames as unknown[]).length === 0) {
    return {
      frames: [],
      summary: defaultSummary(0, raw.summary as Partial<MuJoCoSolveResponse["summary"]>),
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
    summary: defaultSummary(framesProcessed, rawSummary as Partial<MuJoCoSolveResponse["summary"]>),
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

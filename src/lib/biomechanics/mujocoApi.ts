/**
 * Client for the MuJoCo physics backend.
 * Sends smoothed landmarks and receives enriched kinetic data.
 */

import type { FrameLandmarks } from "./types";

export interface MuJoCoJointResult {
  angle_deg: number;
  velocity_rad_s: number;
  torque_nm: number;
  /** e.g. ``mujoco_inverse_dynamics`` vs ``smpl_keypoint_geometry`` from biomech-worker */
  estimate?: string;
}

export type TwoMassStance = "none" | "l" | "r" | "double";

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
  /** Two-mass vGRF stance: flight / left / right (sprint pipeline omits double support) */
  two_mass_stance?: TwoMassStance;
  /** e.g. landmark_sprint — how stance was inferred */
  two_mass_stance_source?: string;
  vgrf_model?: string;
  vertical_force?: number;
  keypoints3d?: number[][];
  /** SMPL surface vertices for this frame: [6890, 3] in metres, y-up. */
  vertices?: number[][];
}

/**
 * Image-space ground / contact hints from MMPose COCO-17 ankles (biomech-worker Colab).
 * ``y`` increases downward in the frame; ``floor_y_norm`` tracks a local ground band.
 */
export interface MmposeGait2dSeries {
  schema_version: number;
  coco_layout: string;
  coordinate: string;
  image_height_px: number;
  image_width_px: number;
  fps: number;
  kpt_score_thr?: number;
  method?: string;
  floor_y_norm: number[];
  ankle_l_y_norm: number[];
  ankle_r_y_norm: number[];
  clearance_l: number[];
  clearance_r: number[];
  contact_hint_l: number[];
  contact_hint_r: number[];
}

export function parseMmposeGait2d(raw: unknown): MmposeGait2dSeries | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const need = [
    "floor_y_norm",
    "ankle_l_y_norm",
    "ankle_r_y_norm",
    "clearance_l",
    "clearance_r",
    "contact_hint_l",
    "contact_hint_r",
  ] as const;
  const arrays: number[][] = [];
  for (const k of need) {
    if (!Array.isArray(o[k])) return undefined;
    arrays.push((o[k] as unknown[]).map((x) => Number(x)));
  }
  const n = arrays[0].length;
  if (n < 1 || !arrays.every((a) => a.length === n)) return undefined;
  return {
    schema_version: Number(o.schema_version ?? 0),
    coco_layout: String(o.coco_layout ?? "body17"),
    coordinate: String(o.coordinate ?? "image_y_down_normalized"),
    image_height_px: Number(o.image_height_px ?? 1),
    image_width_px: Number(o.image_width_px ?? 1),
    fps: Number(o.fps ?? 0),
    kpt_score_thr: o.kpt_score_thr != null ? Number(o.kpt_score_thr) : undefined,
    method: o.method != null ? String(o.method) : undefined,
    floor_y_norm: arrays[0],
    ankle_l_y_norm: arrays[1],
    ankle_r_y_norm: arrays[2],
    clearance_l: arrays[3],
    clearance_r: arrays[4],
    contact_hint_l: arrays[5],
    contact_hint_r: arrays[6],
  };
}

export function parseTwoMassStance(v: unknown): TwoMassStance | undefined {
  if (v === "none" || v === "l" || v === "r" || v === "double") return v;
  return undefined;
}

/** Short label for charts / UI */
export function twoMassStanceLabel(s: TwoMassStance | undefined): string {
  switch (s) {
    case "l":
      return "left stance";
    case "r":
      return "right stance";
    case "double":
      return "double support";
    case "none":
      return "flight";
    default:
      return "—";
  }
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
  /** Set by ``POST /analyze-full`` when Colab returned ``metadata.mmpose_gait_2d`` */
  mmposeGait2d?: MmposeGait2dSeries;
  /** Full ``results.metadata`` from analyze-full (merged Colab + worker) */
  backendMetadata?: Record<string, unknown>;
  /** SMPL face indices (~13k triangles) shared across all frames. */
  smplFaces?: number[][];
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

  const kp = raw.keypoints3d as unknown;
  const keypoints3d = Array.isArray(kp)
    ? (kp as unknown[])
        .map((row) => (Array.isArray(row) ? (row as unknown[]).map((v) => Number(v)) : null))
        .filter((r): r is number[] => Array.isArray(r) && r.length >= 3)
    : undefined;

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
    two_mass_stance: parseTwoMassStance(raw.two_mass_stance),
    vertical_force: Number.isFinite(vf) ? vf : undefined,
    ...(keypoints3d && keypoints3d.length > 0 ? { keypoints3d } : {}),
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

export interface AnalyzeFullQuery {
  heightCm?: number;
  weightKg?: number;
  fps?: number;
}

/** ``POST /analyze-full`` → ``{ status, results: { metadata, frames } }`` (HTTP 200). */
function normaliseAnalyzeFullEnvelope(data: Record<string, unknown>): MuJoCoSolveResponse {
  if (data.status === "error") {
    throw new Error(String(data.error ?? "analyze-full returned status error"));
  }
  const results = data.results as Record<string, unknown> | undefined;
  if (!results || !Array.isArray(results.frames)) {
    throw new Error("Invalid analyze-full payload: missing results.frames");
  }
  const metadata = (results.metadata ?? {}) as Record<string, unknown>;
  const frames = results.frames as unknown[];
  const fpsMeta = Number(metadata.fps ?? 30) || 30;
  let tw = 0;
  for (const fr of frames) {
    const w = (fr as { warnings?: unknown }).warnings;
    if (Array.isArray(w)) tw += w.length;
  }
  const wrapped: Record<string, unknown> = {
    frames: results.frames,
    summary: {
      total_frames: frames.length,
      solve_time_s: 0,
      mean_residual_m: 0,
      max_residual_m: 0,
      total_warnings: tw,
      fps: fpsMeta,
    },
  };
  const base = normaliseResponse(wrapped);
  const gait = parseMmposeGait2d(metadata.mmpose_gait_2d);
  return {
    ...base,
    ...(gait ? { mmposeGait2d: gait } : {}),
    backendMetadata: metadata,
    _raw: data,
  };
}

/**
 * GPU path: video → Colab (mmhuman3d + optional MMPose) → worker MuJoCo.
 * Requires ``COLAB_BRIDGE_URL`` on the worker. Response may include ``mmposeGait2d``.
 */
export async function fetchAnalyzeFullVideo(
  videoFile: File,
  query: AnalyzeFullQuery = {},
): Promise<MuJoCoSolveResponse> {
  const base = getMuJoCoBackendUrl().replace(/\/$/, "");
  const fd = new FormData();
  fd.append("video", videoFile, videoFile.name || "upload.mp4");
  const params = new URLSearchParams();
  if (query.heightCm != null) params.set("height_cm", String(query.heightCm));
  if (query.weightKg != null) params.set("weight_kg", String(query.weightKg));
  if (query.fps != null) params.set("fps", String(query.fps));
  const qs = params.toString();
  const res = await fetch(`${base}/analyze-full${qs ? `?${qs}` : ""}`, {
    method: "POST",
    body: fd,
    signal: AbortSignal.timeout(600_000),
  });
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`analyze-full: non-JSON body (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(String(data.error ?? data.detail ?? `HTTP ${res.status}`));
  }
  if (data.status === "error") {
    throw new Error(String(data.error ?? "analyze-full failed"));
  }
  return normaliseAnalyzeFullEnvelope(data);
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

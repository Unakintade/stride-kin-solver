/**
 * Visibility / confidence gating for landmark-based measurements.
 *
 * MediaPipe provides per-landmark visibility scores (0–1). When key landmarks
 * are poorly visible the resulting joint angles are unreliable. This module
 * provides utilities to:
 *  1. Check whether a set of landmarks meets a minimum visibility threshold.
 *  2. Mark individual joint-angle measurements as low-confidence.
 *  3. Interpolate or hold-last-value for gated frames.
 */

import type { FrameLandmarks, JointAngle } from "./types";

/** Default minimum visibility to trust a landmark. */
export const DEFAULT_VISIBILITY_THRESHOLD = 0.65;

/**
 * Returns true if ALL specified landmark indices have visibility ≥ threshold.
 */
export function landmarksVisible(
  frame: FrameLandmarks,
  indices: number[],
  threshold = DEFAULT_VISIBILITY_THRESHOLD
): boolean {
  for (const idx of indices) {
    if ((frame.visibility[idx] ?? 0) < threshold) return false;
  }
  return true;
}

/**
 * Returns the minimum visibility among the given landmark indices for a frame.
 */
export function minVisibility(frame: FrameLandmarks, indices: number[]): number {
  let min = 1;
  for (const idx of indices) {
    const v = frame.visibility[idx] ?? 0;
    if (v < min) min = v;
  }
  return min;
}

/**
 * Given a time-series of joint angles where some entries may be NaN (gated),
 * linearly interpolate across the gaps. Edge gaps are held constant.
 * Mutates the array in place.
 */
export function interpolateGatedAngles(angles: (number | null)[]): number[] {
  const out = angles.map((a) => (a === null ? NaN : a));

  // Forward-fill leading NaNs
  let firstValid = out.findIndex((v) => !isNaN(v));
  if (firstValid < 0) return out.map(() => 0); // all gated
  for (let i = 0; i < firstValid; i++) out[i] = out[firstValid];

  // Backward-fill trailing NaNs
  let lastValid = out.length - 1;
  while (lastValid >= 0 && isNaN(out[lastValid])) lastValid--;
  for (let i = lastValid + 1; i < out.length; i++) out[i] = out[lastValid];

  // Linear interpolation for interior gaps
  let i = firstValid + 1;
  while (i <= lastValid) {
    if (!isNaN(out[i])) { i++; continue; }
    const gapStart = i - 1;
    let gapEnd = i;
    while (gapEnd <= lastValid && isNaN(out[gapEnd])) gapEnd++;
    const span = gapEnd - gapStart;
    for (let j = gapStart + 1; j < gapEnd; j++) {
      const t = (j - gapStart) / span;
      out[j] = out[gapStart] * (1 - t) + out[gapEnd] * t;
    }
    i = gapEnd + 1;
  }

  return out;
}

/**
 * Compute a per-frame confidence score (0–1) for a joint defined by 3 landmarks.
 * This is the minimum visibility of the three landmarks involved.
 */
export function jointConfidence(frame: FrameLandmarks, landmarkIndices: [number, number, number]): number {
  return minVisibility(frame, landmarkIndices);
}

/**
 * Baseline kinematics engine — Monday 23 Mar 2026 12pm CT snapshot.
 *
 * The Monday pipeline was:
 *   smoothLandmarks (3-state CA Kalman, visibility-scaled R) → computeKinematics
 *   with NO visibility gating and NO homography correction.
 *
 * This wrapper simply calls the current computeKinematics with those features
 * disabled so the comparison isolates the effect of the new refinements.
 */

import type { FrameLandmarks, FrameResult } from "./types";
import { computeKinematics } from "./kinematics";

/**
 * Monday baseline: uses the same geometric kinematics engine but with
 * visibility threshold set to 0 (no gating) and no homography.
 */
export function computeKinematicsBaseline(
  landmarks: FrameLandmarks[],
  fps: number,
  onProgress?: (progress: number) => void,
): FrameResult[] {
  return computeKinematics(landmarks, fps, onProgress, {
    visibilityThreshold: 0,   // disable visibility gating
    homography: null,          // no homography correction
    metricCalibration: null,   // use simple scale-factor estimation
  });
}

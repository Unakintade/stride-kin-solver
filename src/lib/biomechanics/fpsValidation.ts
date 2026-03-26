/**
 * FPS sanity-checking utilities for sprint capture.
 */

import {
  RECOMMENDED_SPRINT_CAPTURE_FPS,
  LOW_FPS_WARNING_THRESHOLD,
} from "./constants";

export interface FpsValidationResult {
  /** True if the FPS is usable (above LOW_FPS_WARNING_THRESHOLD). */
  ok: boolean;
  /** Human-readable warning, or null if everything looks fine. */
  warning: string | null;
  /** Severity level for UI display. */
  severity: "none" | "info" | "warn" | "error";
}

/**
 * Validate user-specified FPS against video metadata (if available) and
 * recommended sprint capture rates.
 *
 * @param userFps  The FPS the user entered / the pipeline will use.
 * @param metadataFps  The FPS inferred from the video container (may be null).
 */
export function validateFps(
  userFps: number,
  metadataFps: number | null
): FpsValidationResult {
  if (userFps <= 0 || !Number.isFinite(userFps)) {
    return {
      ok: false,
      warning: "FPS must be a positive number.",
      severity: "error",
    };
  }

  // Check mismatch with metadata
  if (metadataFps != null && metadataFps > 0) {
    const ratio = userFps / metadataFps;
    if (ratio < 0.8 || ratio > 1.2) {
      return {
        ok: true,
        warning: `User FPS (${userFps}) differs significantly from video metadata (~${metadataFps.toFixed(0)} Hz). Verify the setting matches the actual capture rate, or timestamps and velocities will be wrong.`,
        severity: "warn",
      };
    }
  }

  if (userFps < LOW_FPS_WARNING_THRESHOLD) {
    return {
      ok: true,
      warning: `At ${userFps} Hz, fast limb motion is often undersampled. Prefer ${RECOMMENDED_SPRINT_CAPTURE_FPS}+ Hz for sprint capture.`,
      severity: "warn",
    };
  }

  if (userFps < RECOMMENDED_SPRINT_CAPTURE_FPS) {
    return {
      ok: true,
      warning: `${userFps} Hz may blur foot contacts. ${RECOMMENDED_SPRINT_CAPTURE_FPS}+ Hz recommended for explosive sprinting.`,
      severity: "info",
    };
  }

  return { ok: true, warning: null, severity: "none" };
}

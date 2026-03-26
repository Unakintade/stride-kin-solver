import type { FrameLandmarks } from "./types";

/**
 * Time-series velocity for a 3D point: central difference on interior frames,
 * forward / backward difference on edges. Uses frame timestamps when available.
 */
export function velocityFromPositionTrack(
  positions: ReadonlyArray<readonly [number, number, number]>,
  timestamps: ReadonlyArray<number>,
  fps: number,
  i: number
): [number, number, number] {
  const n = positions.length;
  if (n < 2) return [0, 0, 0];
  const dtNom = 1 / fps;

  const velAxis = (get: (k: number) => number): number => {
    if (i === 0) {
      const dt = timestamps[1] - timestamps[0];
      const denom = dt > 1e-9 ? dt : dtNom;
      return (get(1) - get(0)) / denom;
    }
    if (i === n - 1) {
      const dt = timestamps[n - 1] - timestamps[n - 2];
      const denom = dt > 1e-9 ? dt : dtNom;
      return (get(n - 1) - get(n - 2)) / denom;
    }
    const dt = timestamps[i + 1] - timestamps[i - 1];
    const denom = dt > 1e-9 ? dt : Math.max(2 * dtNom, 1e-9);
    return (get(i + 1) - get(i - 1)) / denom;
  };

  return [velAxis((k) => positions[k][0]), velAxis((k) => positions[k][1]), velAxis((k) => positions[k][2])];
}

/** Hip-midpoint CoM proxy in calibrated ground-plane metres (x,y); optional planar z. */
export function buildHipComTrack(
  landmarks: FrameLandmarks[],
  toMetric: (imgX: number, imgY: number) => [number, number],
  options: { planarZ: boolean }
): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < landmarks.length; i++) {
    const fl = landmarks[i];
    const ip = fl.positions;
    const wp = fl.worldPositions;
    const comImageX = (ip[23][0] + ip[24][0]) / 2;
    const comImageY = (ip[23][1] + ip[24][1]) / 2;
    const [comX, comY] = toMetric(comImageX, comImageY);
    const comZ = options.planarZ ? 0 : (wp[23][2] + wp[24][2]) / 2;
    out.push([comX, comY, comZ]);
  }
  return out;
}

/**
 * Numerical differentiation helpers for kinematic time-series.
 *
 * All functions operate on plain `number[]` arrays and return arrays of the
 * same length. Boundary values are handled with one-sided differences so the
 * output never contains NaN.
 */

/**
 * Central finite-difference first derivative.
 *
 * Interior points use the symmetric (2nd-order) formula:
 *   f'(i) ≈ (f[i+1] - f[i-1]) / (2·dt)
 *
 * End-points fall back to forward / backward differences.
 */
export function centralDiff(signal: number[], dt: number): number[] {
  const N = signal.length;
  if (N === 0) return [];
  if (N === 1) return [0];

  const out = new Array<number>(N);

  // Forward difference at start
  out[0] = (signal[1] - signal[0]) / dt;

  // Central differences
  const dt2 = 2 * dt;
  for (let i = 1; i < N - 1; i++) {
    out[i] = (signal[i + 1] - signal[i - 1]) / dt2;
  }

  // Backward difference at end
  out[N - 1] = (signal[N - 1] - signal[N - 2]) / dt;

  return out;
}

/**
 * Savitzky–Golay smoothing derivative (quadratic, window = 5).
 *
 * Uses the classic SG coefficients for the first derivative with a 5-point
 * quadratic fit: [-2, -1, 0, 1, 2] / (10·dt).
 *
 * Falls back to central differences for shorter signals or at the two
 * boundary points on each side.
 */
export function sgDeriv5(signal: number[], dt: number): number[] {
  const N = signal.length;
  if (N < 5) return centralDiff(signal, dt);

  const out = new Array<number>(N);

  // Boundary: use central diff for first 2 and last 2
  out[0] = (signal[1] - signal[0]) / dt;
  out[1] = (signal[2] - signal[0]) / (2 * dt);
  out[N - 2] = (signal[N - 1] - signal[N - 3]) / (2 * dt);
  out[N - 1] = (signal[N - 1] - signal[N - 2]) / dt;

  // SG interior: coeffs [-2, -1, 0, 1, 2] / (10·dt)
  const denom = 10 * dt;
  for (let i = 2; i < N - 2; i++) {
    out[i] =
      (-2 * signal[i - 2] - signal[i - 1] + signal[i + 1] + 2 * signal[i + 2]) /
      denom;
  }

  return out;
}

/**
 * Choose the best available derivative method for the given signal length.
 * Prefers SG-5 when there are enough samples, otherwise central diff.
 */
export function smartDeriv(signal: number[], dt: number): number[] {
  return signal.length >= 5 ? sgDeriv5(signal, dt) : centralDiff(signal, dt);
}

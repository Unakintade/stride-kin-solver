/**
 * Planar homography correction for image-space landmark coordinates.
 *
 * When a camera films a sprint from an angled perspective, the image-space
 * coordinates suffer from perspective distortion. A homography maps four
 * known coplanar points (in image space) to their real-world positions on
 * the ground plane, producing rectified 2D coordinates suitable for
 * distance/velocity measurements.
 *
 * The 3×3 homography matrix H maps (x_img, y_img) → (X_world, Y_world) via:
 *   [X_world]       [x_img]
 *   [Y_world] = H * [y_img]
 *   [  w    ]       [  1  ]
 *   then divide by w.
 */

export interface HomographyPoint {
  /** Normalised image coordinate (0–1) */
  imgX: number;
  imgY: number;
  /** Real-world coordinate in metres on the ground plane */
  worldX: number;
  worldY: number;
}

/**
 * A 3×3 matrix stored row-major as a flat 9-element array.
 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

/**
 * Compute a 3×3 homography from exactly 4 point correspondences using
 * Direct Linear Transform (DLT).
 *
 * Each correspondence gives two equations; 4 points → 8 equations for 8
 * unknowns (H has 9 entries but is defined up to scale → fix h33 = 1, or
 * solve the 8×9 system via SVD-like approach).
 *
 * For simplicity we solve the 8×8 system with h33 = 1.
 */
export function computeHomography(points: [HomographyPoint, HomographyPoint, HomographyPoint, HomographyPoint]): Mat3 {
  // Build 8×8 system  A * h = b  where h = [h11,h12,h13,h21,h22,h23,h31,h32], h33=1
  const A: number[][] = [];
  const b: number[] = [];

  for (const p of points) {
    const { imgX: x, imgY: y, worldX: X, worldY: Y } = p;
    // Row for X:  x*h11 + y*h12 + h13 - x*X*h31 - y*X*h32 = X
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    // Row for Y:  x*h21 + y*h22 + h23 - x*Y*h31 - y*Y*h32 = Y
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }

  const h = solveLinear8(A, b);

  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * Apply homography H to a 2D point, returning rectified (X, Y).
 */
export function applyHomography(H: Mat3, x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-12) return [x, y]; // degenerate — pass through
  const X = (H[0] * x + H[1] * y + H[2]) / w;
  const Y = (H[3] * x + H[4] * y + H[5]) / w;
  return [X, Y];
}

/**
 * Compute the reprojection error (RMS in world units) to validate the homography.
 */
export function homographyError(H: Mat3, points: HomographyPoint[]): number {
  let sumSq = 0;
  for (const p of points) {
    const [X, Y] = applyHomography(H, p.imgX, p.imgY);
    sumSq += (X - p.worldX) ** 2 + (Y - p.worldY) ** 2;
  }
  return Math.sqrt(sumSq / points.length);
}

// --- Gaussian elimination for an 8×8 system ---

function solveLinear8(A: number[][], b: number[]): number[] {
  const n = 8;
  // Augmented matrix
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-14) {
      throw new Error("Homography points are degenerate (collinear or coincident)");
    }

    for (let j = col; j <= n; j++) M[col][j] /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  return M.map((row) => row[n]);
}

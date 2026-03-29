/**
 * Camera stabilization via template-matching a user-selected reference point.
 *
 * The user clicks a stationary object in frame 0. We extract a small patch
 * around that point and track it across every subsequent frame using
 * normalised cross-correlation (NCC) on a canvas-based grayscale image.
 *
 * The per-frame (dx, dy) offset — in normalised [0,1] coordinates — is then
 * subtracted from every landmark position to compensate for camera panning.
 */

/** Pixel coordinate in the original video resolution. */
export interface PixelPoint {
  x: number;
  y: number;
}

/** Per-frame camera offset in normalised image coordinates [0,1]. */
export interface CameraOffset {
  frameIdx: number;
  dx: number; // shift in x (normalised)
  dy: number; // shift in y (normalised)
}

const PATCH_RADIUS = 24; // half-size of the template patch (pixels)
const SEARCH_RADIUS = 60; // how far to search around previous position

/**
 * Extract a grayscale Uint8 buffer from a canvas context for a given rect.
 */
function extractGray(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): Uint8Array {
  const imgData = ctx.getImageData(x, y, w, h);
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const r = imgData.data[i * 4];
    const g = imgData.data[i * 4 + 1];
    const b = imgData.data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

/**
 * Normalised cross-correlation between a template and a same-sized region.
 * Returns value in [-1, 1]; higher = better match.
 */
function ncc(template: Uint8Array, candidate: Uint8Array): number {
  const n = template.length;
  if (n === 0 || candidate.length !== n) return -1;

  let sumT = 0, sumC = 0;
  for (let i = 0; i < n; i++) { sumT += template[i]; sumC += candidate[i]; }
  const meanT = sumT / n;
  const meanC = sumC / n;

  let num = 0, denT = 0, denC = 0;
  for (let i = 0; i < n; i++) {
    const dt = template[i] - meanT;
    const dc = candidate[i] - meanC;
    num += dt * dc;
    denT += dt * dt;
    denC += dc * dc;
  }

  const den = Math.sqrt(denT * denC);
  return den === 0 ? 0 : num / den;
}

/**
 * Track the reference point across the entire video and return per-frame offsets.
 *
 * @param videoElement  The loaded <video> element.
 * @param refPoint      The user-selected reference point in *pixel* coords of the video.
 * @param fps           Analysis FPS.
 * @param totalFrames   Number of frames to process.
 * @param onProgress    Optional progress callback (0-1).
 */
export async function trackReferencePoint(
  videoElement: HTMLVideoElement,
  refPoint: PixelPoint,
  fps: number,
  totalFrames: number,
  onProgress?: (progress: number) => void,
): Promise<CameraOffset[]> {
  const vw = videoElement.videoWidth;
  const vh = videoElement.videoHeight;
  const frameInterval = 1 / fps;

  // Off-screen canvas for pixel access
  const canvas = document.createElement("canvas");
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  // Seek to frame 0 and extract template
  videoElement.currentTime = 0;
  await new Promise<void>((r) => { videoElement.onseeked = () => r(); });
  ctx.drawImage(videoElement, 0, 0, vw, vh);

  const patchSize = PATCH_RADIUS * 2 + 1;
  const tplX = Math.max(0, Math.round(refPoint.x) - PATCH_RADIUS);
  const tplY = Math.max(0, Math.round(refPoint.y) - PATCH_RADIUS);
  const tplW = Math.min(patchSize, vw - tplX);
  const tplH = Math.min(patchSize, vh - tplY);
  const template = extractGray(ctx, tplX, tplY, tplW, tplH);

  const offsets: CameraOffset[] = [];
  let prevX = refPoint.x;
  let prevY = refPoint.y;

  // Frame 0 has zero offset by definition
  offsets.push({ frameIdx: 0, dx: 0, dy: 0 });

  for (let i = 1; i < totalFrames; i++) {
    const time = i * frameInterval;
    if (time > videoElement.duration) break;

    videoElement.currentTime = time;
    await new Promise<void>((r) => { videoElement.onseeked = () => r(); });
    ctx.drawImage(videoElement, 0, 0, vw, vh);

    // Search window around previous position
    const searchX0 = Math.max(0, Math.round(prevX) - SEARCH_RADIUS - PATCH_RADIUS);
    const searchY0 = Math.max(0, Math.round(prevY) - SEARCH_RADIUS - PATCH_RADIUS);
    const searchX1 = Math.min(vw - tplW, Math.round(prevX) + SEARCH_RADIUS - PATCH_RADIUS);
    const searchY1 = Math.min(vh - tplH, Math.round(prevY) + SEARCH_RADIUS - PATCH_RADIUS);

    let bestScore = -2;
    let bestX = Math.round(prevX);
    let bestY = Math.round(prevY);

    // Step by 2 pixels for speed, then refine
    for (let sy = searchY0; sy <= searchY1; sy += 2) {
      for (let sx = searchX0; sx <= searchX1; sx += 2) {
        const candidate = extractGray(ctx, sx, sy, tplW, tplH);
        const score = ncc(template, candidate);
        if (score > bestScore) {
          bestScore = score;
          bestX = sx + PATCH_RADIUS;
          bestY = sy + PATCH_RADIUS;
        }
      }
    }

    // Sub-pixel refine: search ±1 around best
    const refX0 = Math.max(0, bestX - PATCH_RADIUS - 1);
    const refY0 = Math.max(0, bestY - PATCH_RADIUS - 1);
    const refX1 = Math.min(vw - tplW, bestX - PATCH_RADIUS + 1);
    const refY1 = Math.min(vh - tplH, bestY - PATCH_RADIUS + 1);
    for (let sy = refY0; sy <= refY1; sy++) {
      for (let sx = refX0; sx <= refX1; sx++) {
        const candidate = extractGray(ctx, sx, sy, tplW, tplH);
        const score = ncc(template, candidate);
        if (score > bestScore) {
          bestScore = score;
          bestX = sx + PATCH_RADIUS;
          bestY = sy + PATCH_RADIUS;
        }
      }
    }

    prevX = bestX;
    prevY = bestY;

    // Offset = current position − original position, in normalised coords
    const dx = (bestX - refPoint.x) / vw;
    const dy = (bestY - refPoint.y) / vh;
    offsets.push({ frameIdx: i, dx, dy });

    if (onProgress) onProgress(i / totalFrames);
  }

  console.log(`[Stabilization] Tracked ${offsets.length} frames, max shift: ${(Math.max(...offsets.map(o => Math.abs(o.dx))) * vw).toFixed(1)}px`);
  return offsets;
}

/**
 * Apply camera offsets to landmark positions (normalised image coords).
 * Subtracts the camera shift so landmarks are in a stabilised coordinate frame.
 */
export function applyStabilization(
  landmarks: import("./types").FrameLandmarks[],
  offsets: CameraOffset[],
): import("./types").FrameLandmarks[] {
  // Build a lookup by frameIdx
  const offsetMap = new Map(offsets.map((o) => [o.frameIdx, o]));

  return landmarks.map((frame) => {
    const offset = offsetMap.get(frame.frameIdx);
    if (!offset) return frame;

    return {
      ...frame,
      positions: frame.positions.map(([x, y, z]) => [
        x - offset.dx,
        y - offset.dy,
        z,
      ]),
      // World positions are in metres and independent of camera pixel motion,
      // but the x/y world coords from BlazePose are still camera-relative,
      // so we apply the same normalised correction.
      worldPositions: frame.worldPositions.map(([x, y, z]) => [
        x - offset.dx,
        y - offset.dy,
        z,
      ]),
    };
  });
}

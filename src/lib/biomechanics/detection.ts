// @ts-nocheck
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FrameLandmarks } from "./types";

let poseLandmarker: any = null;

const VISION_WASM_VERSION = "0.10.34";
const NUM_PASSES = 5;

export async function initPoseDetector(): Promise<any> {
  if (poseLandmarker) return poseLandmarker;

  const vision = await FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_WASM_VERSION}/wasm`
  );

  const options = {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
      delegate: "GPU" as const,
    },
    runningMode: "VIDEO" as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };

  try {
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, options);
  } catch (gpuError) {
    console.warn("GPU delegate failed, falling back to CPU:", gpuError);
    options.baseOptions.delegate = "CPU" as any;
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, options);
  }

  return poseLandmarker;
}

/**
 * Run a single detection pass over the video, returning per-frame landmarks.
 */
async function singlePass(
  detector: any,
  videoElement: HTMLVideoElement,
  fps: number,
  totalFrames: number,
  frameInterval: number,
  duration: number,
  passOffset: number,
): Promise<(FrameLandmarks | null)[]> {
  const results: (FrameLandmarks | null)[] = new Array(totalFrames).fill(null);

  // Small sub-pixel time jitter per pass to get independent samples
  const jitter = passOffset * 0.0001;

  for (let i = 0; i < totalFrames; i++) {
    const time = i * frameInterval + jitter;
    if (time > duration) break;

    videoElement.currentTime = time;
    await new Promise<void>((resolve) => {
      videoElement.onseeked = () => resolve();
    });

    const timestampMs = time * 1000;
    const result = detector.detectForVideo(videoElement, timestampMs);

    if (result.landmarks.length > 0 && result.worldLandmarks.length > 0) {
      const poseLm = result.landmarks[0];
      const worldLm = result.worldLandmarks[0];

      results[i] = {
        frameIdx: i,
        timestamp: i * frameInterval,
        positions: poseLm.map((lm: any) => [lm.x, lm.y, lm.z]),
        worldPositions: worldLm.map((lm: any) => [lm.x, lm.y, lm.z]),
        visibility: poseLm.map((lm: any) => lm.visibility ?? 0.5),
      };
    }
  }

  return results;
}

/**
 * For an array of numbers, return the median.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Merge multiple passes for a single frame.
 * Strategy: pick the top passes by mean visibility (confidence), then take
 * the median position across those passes for each landmark.
 */
function mergeFrame(
  candidates: FrameLandmarks[],
  frameIdx: number,
  timestamp: number,
): FrameLandmarks {
  if (candidates.length === 1) return candidates[0];

  // Score each candidate by mean visibility
  const scored = candidates.map((c) => ({
    candidate: c,
    meanVis: c.visibility.reduce((s, v) => s + v, 0) / c.visibility.length,
  }));

  // Sort by confidence descending, keep top 3 (or all if fewer)
  scored.sort((a, b) => b.meanVis - a.meanVis);
  const topK = scored.slice(0, Math.min(3, scored.length));
  const top = topK.map((s) => s.candidate);

  const numLandmarks = top[0].positions.length;
  const positions: number[][] = [];
  const worldPositions: number[][] = [];
  const visibility: number[] = [];

  for (let lm = 0; lm < numLandmarks; lm++) {
    // Median of each coordinate
    positions.push([
      median(top.map((c) => c.positions[lm][0])),
      median(top.map((c) => c.positions[lm][1])),
      median(top.map((c) => c.positions[lm][2])),
    ]);
    worldPositions.push([
      median(top.map((c) => c.worldPositions[lm][0])),
      median(top.map((c) => c.worldPositions[lm][1])),
      median(top.map((c) => c.worldPositions[lm][2])),
    ]);
    // Take the max visibility across passes (best confidence)
    visibility.push(Math.max(...top.map((c) => c.visibility[lm])));
  }

  return { frameIdx, timestamp, positions, worldPositions, visibility };
}

export async function detectPoseInVideo(
  videoElement: HTMLVideoElement,
  fps: number,
  onProgress: (progress: number, frame: number, total: number) => void,
  maxFrames?: number
): Promise<FrameLandmarks[]> {
  const detector = await initPoseDetector();

  const duration = videoElement.duration;
  const totalFrames = maxFrames ?? Math.floor(duration * fps);
  const frameInterval = 1 / fps;

  // Collect results from all passes
  const allPasses: (FrameLandmarks | null)[][] = [];

  for (let pass = 0; pass < NUM_PASSES; pass++) {
    console.log(`[Detection] Pass ${pass + 1}/${NUM_PASSES}`);
    const passResults = await singlePass(
      detector,
      videoElement,
      fps,
      totalFrames,
      frameInterval,
      duration,
      pass,
    );
    allPasses.push(passResults);

    // Report progress: each pass is a fraction of the total
    const overallProgress = (pass + 1) / NUM_PASSES;
    onProgress(overallProgress, pass + 1, NUM_PASSES);
  }

  // Merge passes per frame using median fusion
  console.log("[Detection] Merging passes with median fusion...");
  const landmarks: FrameLandmarks[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const candidates: FrameLandmarks[] = [];
    for (let pass = 0; pass < NUM_PASSES; pass++) {
      const result = allPasses[pass][i];
      if (result) candidates.push(result);
    }

    if (candidates.length > 0) {
      landmarks.push(mergeFrame(candidates, i, i * frameInterval));
    }
  }

  console.log(
    `[Detection] ${NUM_PASSES}-pass median fusion complete: ${landmarks.length} frames`
  );

  return landmarks;
}

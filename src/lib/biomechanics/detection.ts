// @ts-nocheck
import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FrameLandmarks } from "./types";

let poseLandmarker: any = null;

export async function initPoseDetector(): Promise<any> {
  if (poseLandmarker) return poseLandmarker;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  return poseLandmarker;
}

export async function detectPoseInVideo(
  videoElement: HTMLVideoElement,
  fps: number,
  onProgress: (progress: number, frame: number, total: number) => void,
  maxFrames?: number
): Promise<FrameLandmarks[]> {
  const detector = await initPoseDetector();
  const landmarks: FrameLandmarks[] = [];

  const duration = videoElement.duration;
  const totalFrames = maxFrames ?? Math.floor(duration * fps);
  const frameInterval = 1 / fps;

  for (let i = 0; i < totalFrames; i++) {
    const time = i * frameInterval;
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

      landmarks.push({
        frameIdx: i,
        timestamp: time,
        positions: poseLm.map((lm: any) => [lm.x, lm.y, lm.z]),
        worldPositions: worldLm.map((lm: any) => [lm.x, lm.y, lm.z]),
        visibility: poseLm.map((lm: any) => lm.visibility ?? 0.5),
      });
    }

    onProgress((i + 1) / totalFrames, i + 1, totalFrames);
  }

  return landmarks;
}

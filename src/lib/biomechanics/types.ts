export interface FrameLandmarks {
  frameIdx: number;
  timestamp: number;
  positions: number[][]; // (33, 3) normalized image coords
  worldPositions: number[][]; // (33, 3) in metres
  visibility: number[]; // (33,) confidence scores
}

export interface JointAngle {
  name: string;
  angleDeg: number;
  velocityRadS: number;
  /** Minimum visibility of the landmarks involved (0–1). Values below ~0.65 are suspect. */
  confidence: number;
}

export interface FrameResult {
  timestamp: number;
  frameIdx: number;
  jointAngles: JointAngle[];
  strideLength: number;
  comPosition: [number, number, number];
  comVelocity: [number, number, number];
  warnings: string[];
}

export interface AnalysisState {
  status: 'idle' | 'loading-video' | 'detecting' | 'filtering' | 'computing-kinematics' | 'complete' | 'error';
  progress: number;
  currentStage: string;
  rawLandmarks: FrameLandmarks[];
  filteredLandmarks: FrameLandmarks[];
  results: FrameResult[];
  videoInfo: {
    width: number;
    height: number;
    fps: number;
    totalFrames: number;
    duration: number;
  } | null;
  error: string | null;
}

export interface PipelineStage {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  progress: number;
}

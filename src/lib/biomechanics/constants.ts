// MediaPipe BlazePose landmark indices
export const LANDMARK_NAMES: Record<number, string> = {
  0: "nose", 1: "left_eye_inner", 2: "left_eye", 3: "left_eye_outer",
  4: "right_eye_inner", 5: "right_eye", 6: "right_eye_outer",
  7: "left_ear", 8: "right_ear", 9: "mouth_left", 10: "mouth_right",
  11: "left_shoulder", 12: "right_shoulder", 13: "left_elbow",
  14: "right_elbow", 15: "left_wrist", 16: "right_wrist",
  17: "left_pinky", 18: "right_pinky", 19: "left_index",
  20: "right_index", 21: "left_thumb", 22: "right_thumb",
  23: "left_hip", 24: "right_hip", 25: "left_knee", 26: "right_knee",
  27: "left_ankle", 28: "right_ankle", 29: "left_heel",
  30: "right_heel", 31: "left_foot_index", 32: "right_foot_index",
};

// Landmarks used for IK targets
export const IK_LANDMARKS: Record<string, number> = {
  left_shoulder: 11, right_shoulder: 12,
  left_elbow: 13, right_elbow: 14,
  left_wrist: 15, right_wrist: 16,
  left_hip: 23, right_hip: 24,
  left_knee: 25, right_knee: 26,
  left_ankle: 27, right_ankle: 28,
};

// Limb segments for anthropometric scaling
export const LIMB_SEGMENTS: Record<string, [number, number]> = {
  left_upper_arm: [11, 13],
  right_upper_arm: [12, 14],
  left_forearm: [13, 15],
  right_forearm: [14, 16],
  left_thigh: [23, 25],
  right_thigh: [24, 26],
  left_shank: [25, 27],
  right_shank: [26, 28],
  torso: [11, 23],
};

// Skeleton connections for drawing
export const SKELETON_CONNECTIONS: [number, number][] = [
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [11, 12],           // shoulders
  [23, 24],           // hips
  [11, 23], [12, 24], // torso
  [23, 25], [25, 27], // left leg
  [24, 26], [26, 28], // right leg
  [27, 29], [28, 30], // heels
  [27, 31], [28, 32], // foot index
];

// Physiological joint velocity limits (rad/s)
export const JOINT_VELOCITY_LIMITS: Record<string, number> = {
  hip_flexion: 20.0,
  knee_extension: 25.0,
  ankle_plantarflexion: 18.0,
  shoulder_flexion: 15.0,
  elbow_flexion: 20.0,
  default: 30.0,
};

// Kalman filter defaults
export const KF_PROCESS_NOISE_STD = 0.5;
export const KF_BASE_MEASUREMENT_NOISE = 0.02;
export const KF_MIN_VISIBILITY = 0.1;

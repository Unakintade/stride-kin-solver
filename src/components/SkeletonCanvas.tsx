import React, { useRef, useEffect } from "react";
import type { FrameLandmarks } from "@/lib/biomechanics/types";
import { SKELETON_CONNECTIONS, IK_LANDMARKS } from "@/lib/biomechanics/constants";

interface Props {
  landmarks: FrameLandmarks | null;
  width: number;
  height: number;
  showLabels?: boolean;
}

const JOINT_COLORS: Record<string, string> = {
  left_shoulder: "#22d3ee", right_shoulder: "#22d3ee",
  left_elbow: "#34d399", right_elbow: "#34d399",
  left_wrist: "#a78bfa", right_wrist: "#a78bfa",
  left_hip: "#f59e0b", right_hip: "#f59e0b",
  left_knee: "#ef4444", right_knee: "#ef4444",
  left_ankle: "#ec4899", right_ankle: "#ec4899",
};

const SkeletonCanvas: React.FC<Props> = ({ landmarks, width, height, showLabels = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !landmarks) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const positions = landmarks.positions;
    const visibility = landmarks.visibility;

    // Draw connections
    ctx.lineWidth = 2.5;
    for (const [a, b] of SKELETON_CONNECTIONS) {
      if (visibility[a] < 0.3 || visibility[b] < 0.3) continue;
      const ax = positions[a][0] * width;
      const ay = positions[a][1] * height;
      const bx = positions[b][0] * width;
      const by = positions[b][1] * height;

      ctx.beginPath();
      ctx.strokeStyle = `hsla(160, 70%, 45%, ${Math.min(visibility[a], visibility[b])})`;
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // Draw IK landmark joints (highlighted)
    for (const [name, idx] of Object.entries(IK_LANDMARKS)) {
      if (visibility[idx] < 0.3) continue;
      const x = positions[idx][0] * width;
      const y = positions[idx][1] * height;

      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = JOINT_COLORS[name] || "#22d3ee";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (showLabels) {
        ctx.font = "9px 'JetBrains Mono', monospace";
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText(name.replace(/_/g, " "), x + 8, y - 4);
      }
    }

    // Draw other landmarks (dimmer)
    for (let i = 0; i < 33; i++) {
      if (Object.values(IK_LANDMARKS).includes(i)) continue;
      if (visibility[i] < 0.3) continue;
      const x = positions[i][0] * width;
      const y = positions[i][1] * height;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${visibility[i] * 0.4})`;
      ctx.fill();
    }
  }, [landmarks, width, height, showLabels]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="absolute inset-0"
    />
  );
};

export default SkeletonCanvas;

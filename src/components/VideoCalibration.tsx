import React, { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Crosshair, Check, X, Ruler } from "lucide-react";

interface Point {
  x: number; // fraction 0–1
  y: number;
}

interface VideoCalibrationProps {
  videoElement: HTMLVideoElement | null;
  videoWidth: number;
  videoHeight: number;
  onCalibrated: (fieldWidthMeters: number) => void;
  disabled?: boolean;
}

const VideoCalibration: React.FC<VideoCalibrationProps> = ({
  videoElement,
  videoWidth,
  videoHeight,
  onCalibrated,
  disabled,
}) => {
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [distance, setDistance] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isCalibrating || points.length >= 2) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setPoints((prev) => [...prev, { x, y }]);
    },
    [isCalibrating, points.length]
  );

  const pixelDistance = (() => {
    if (points.length < 2) return 0;
    const dx = (points[1].x - points[0].x) * videoWidth;
    const dy = (points[1].y - points[0].y) * videoHeight;
    return Math.sqrt(dx * dx + dy * dy);
  })();

  const apply = () => {
    const realDist = parseFloat(distance);
    if (!realDist || realDist <= 0 || pixelDistance === 0) return;
    // scale = meters per pixel, field width = scale * videoWidth
    const scale = realDist / pixelDistance;
    const fieldWidth = scale * videoWidth;
    onCalibrated(fieldWidth);
    reset();
  };

  const reset = () => {
    setIsCalibrating(false);
    setPoints([]);
    setDistance("");
  };

  if (!isCalibrating) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsCalibrating(true)}
        disabled={disabled || !videoElement}
        className="gap-1.5 font-mono text-xs"
      >
        <Ruler className="w-3 h-3" />
        Calibrate from video
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      {/* Instruction banner */}
      <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground bg-secondary/50 rounded px-2 py-1.5">
        <Crosshair className="w-3 h-3 text-primary shrink-0" />
        {points.length === 0 && "Click the first reference point on the video"}
        {points.length === 1 && "Click the second reference point on the video"}
        {points.length === 2 && "Enter the real-world distance between the two points"}
      </div>

      {/* Click overlay — rendered as a portal-like absolute overlay on the video */}
      <div
        ref={overlayRef}
        onClick={handleClick}
        className="absolute inset-0 z-30"
        style={{ cursor: points.length < 2 ? "crosshair" : "default" }}
      >
        {/* Draw points */}
        {points.map((p, i) => (
          <div
            key={i}
            className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary border-2 border-primary-foreground shadow-md"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          />
        ))}
        {/* Draw line between points */}
        {points.length === 2 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <line
              x1={`${points[0].x * 100}%`}
              y1={`${points[0].y * 100}%`}
              x2={`${points[1].x * 100}%`}
              y2={`${points[1].y * 100}%`}
              className="stroke-primary"
              strokeWidth={2}
              strokeDasharray="6 3"
            />
          </svg>
        )}
      </div>

      {/* Distance input + confirm */}
      {points.length === 2 && (
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] font-mono text-muted-foreground">
              Distance between points (m)
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              placeholder="e.g. 10"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              className="w-28 h-7 text-xs font-mono"
              autoFocus
            />
          </div>
          <p className="text-[10px] font-mono text-muted-foreground pb-1">
            {pixelDistance.toFixed(0)} px span →{" "}
            {distance && parseFloat(distance) > 0
              ? `${((parseFloat(distance) / pixelDistance) * videoWidth).toFixed(2)} m field width`
              : "…"}
          </p>
          <Button size="sm" className="h-7 gap-1 text-xs font-mono" onClick={apply} disabled={!distance || parseFloat(distance) <= 0}>
            <Check className="w-3 h-3" /> Apply
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs font-mono" onClick={reset}>
            <X className="w-3 h-3" /> Cancel
          </Button>
        </div>
      )}

      {/* Cancel when still picking points */}
      {points.length < 2 && (
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs font-mono" onClick={reset}>
          <X className="w-3 h-3" /> Cancel
        </Button>
      )}
    </div>
  );
};

export default VideoCalibration;

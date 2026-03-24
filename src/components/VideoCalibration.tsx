import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, X, Ruler } from "lucide-react";

interface Point {
  x: number; // fraction 0–1
  y: number;
}

interface VideoCalibrationProps {
  videoWidth: number;
  videoHeight: number;
  onCalibrated: (fieldWidthMeters: number) => void;
  disabled?: boolean;
}

/**
 * Provides a "Calibrate from video" button.
 * When active, renders an overlay (via `renderOverlay`) that the parent places
 * inside the video's relative container.
 */
export function useVideoCalibration({
  videoWidth,
  videoHeight,
  onCalibrated,
}: {
  videoWidth: number;
  videoHeight: number;
  onCalibrated: (fieldWidthMeters: number) => void;
}) {
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [distance, setDistance] = useState("");

  const handleOverlayClick = useCallback(
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

  /** Render this inside the video's relative container */
  const overlay = isCalibrating ? (
    <div
      onClick={handleOverlayClick}
      className="absolute inset-0 z-30"
      style={{ cursor: points.length < 2 ? "crosshair" : "default" }}
    >
      {points.map((p, i) => (
        <div
          key={i}
          className="absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary border-2 border-primary-foreground shadow-lg"
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
        />
      ))}
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
      {/* Instruction badge */}
      <div className="absolute top-2 left-2 right-2 flex justify-center pointer-events-none">
        <span className="bg-background/90 backdrop-blur-sm text-foreground text-[10px] font-mono px-2 py-1 rounded shadow">
          {points.length === 0 && "Click first reference point"}
          {points.length === 1 && "Click second reference point"}
          {points.length === 2 && "Enter distance below"}
        </span>
      </div>
    </div>
  ) : null;

  /** Render this in the controls area */
  const controls = isCalibrating ? (
    <div className="flex flex-wrap items-end gap-2">
      {points.length === 2 ? (
        <>
          <div className="space-y-1">
            <Label className="text-[10px] font-mono text-muted-foreground">
              Real distance (m)
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
          <p className="text-[10px] font-mono text-muted-foreground pb-1.5 max-w-[12rem]">
            {pixelDistance.toFixed(0)} px →{" "}
            {distance && parseFloat(distance) > 0
              ? `${((parseFloat(distance) / pixelDistance) * videoWidth).toFixed(2)} m field`
              : "…"}
          </p>
          <Button size="sm" className="h-7 gap-1 text-xs font-mono" onClick={apply} disabled={!distance || parseFloat(distance) <= 0}>
            <Check className="w-3 h-3" /> Apply
          </Button>
        </>
      ) : (
        <p className="text-[10px] font-mono text-muted-foreground animate-pulse">
          Mark {2 - points.length} point{points.length === 0 ? "s" : ""} on the video…
        </p>
      )}
      <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs font-mono" onClick={reset}>
        <X className="w-3 h-3" /> Cancel
      </Button>
    </div>
  ) : null;

  const triggerButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setIsCalibrating(true)}
      className="gap-1.5 font-mono text-xs shrink-0"
    >
      <Ruler className="w-3 h-3" />
      Calibrate
    </Button>
  );

  return { isCalibrating, overlay, controls, triggerButton };
}

export default useVideoCalibration;

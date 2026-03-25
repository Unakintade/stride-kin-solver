import React, { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, X, Grid3X3 } from "lucide-react";
import { computeHomography, homographyError, type Mat3, type HomographyPoint } from "@/lib/biomechanics/homography";

interface HomographyCalibrationProps {
  onCalibrated: (H: Mat3) => void;
  disabled?: boolean;
}

/**
 * 4-point homography calibration overlay.
 * The user clicks 4 points on the video and enters their real-world (X, Y) coordinates
 * on the ground plane (in metres). The homography maps normalised image coords → metres.
 */
export function useHomographyCalibration({ onCalibrated }: HomographyCalibrationProps) {
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [points, setPoints] = useState<{ imgX: number; imgY: number }[]>([]);
  const [worldCoords, setWorldCoords] = useState<{ x: string; y: string }[]>([
    { x: "0", y: "0" },
    { x: "10", y: "0" },
    { x: "10", y: "1.22" },
    { x: "0", y: "1.22" },
  ]);
  const [error, setError] = useState<string | null>(null);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isCalibrating || points.length >= 4) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setPoints((prev) => [...prev, { imgX: x, imgY: y }]);
    },
    [isCalibrating, points.length]
  );

  const apply = () => {
    if (points.length < 4) return;
    setError(null);

    try {
      const hPoints: [HomographyPoint, HomographyPoint, HomographyPoint, HomographyPoint] = points.map((p, i) => ({
        imgX: p.imgX,
        imgY: p.imgY,
        worldX: parseFloat(worldCoords[i].x) || 0,
        worldY: parseFloat(worldCoords[i].y) || 0,
      })) as any;

      const H = computeHomography(hPoints);
      const err = homographyError(H, hPoints);

      if (err > 0.5) {
        setError(`High reprojection error (${err.toFixed(3)}m). Check your points.`);
        return;
      }

      onCalibrated(H);
      reset();
    } catch (e: any) {
      setError(e.message || "Failed to compute homography");
    }
  };

  const reset = () => {
    setIsCalibrating(false);
    setPoints([]);
    setError(null);
  };

  const overlay = isCalibrating ? (
    <div
      onClick={handleOverlayClick}
      className="absolute inset-0 z-30"
      style={{ cursor: points.length < 4 ? "crosshair" : "default" }}
    >
      {points.map((p, i) => (
        <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ left: `${p.imgX * 100}%`, top: `${p.imgY * 100}%` }}>
          <div className="w-3.5 h-3.5 rounded-full bg-accent border-2 border-accent-foreground shadow-lg" />
          <span className="text-[9px] font-mono bg-background/80 px-1 rounded mt-0.5 text-foreground">
            P{i + 1}
          </span>
        </div>
      ))}
      {points.length >= 2 && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {points.map((p, i) => {
            const next = points[(i + 1) % points.length];
            if (i >= points.length - 1 && points.length < 4) return null;
            return (
              <line
                key={i}
                x1={`${p.imgX * 100}%`} y1={`${p.imgY * 100}%`}
                x2={`${next.imgX * 100}%`} y2={`${next.imgY * 100}%`}
                className="stroke-accent" strokeWidth={1.5} strokeDasharray="4 2"
              />
            );
          })}
        </svg>
      )}
      <div className="absolute top-2 left-2 right-2 flex justify-center pointer-events-none">
        <span className="bg-background/90 backdrop-blur-sm text-foreground text-[10px] font-mono px-2 py-1 rounded shadow">
          {points.length < 4
            ? `Click point ${points.length + 1} of 4 on the ground plane`
            : "Enter world coordinates below"}
        </span>
      </div>
    </div>
  ) : null;

  const controls = isCalibrating ? (
    <div className="flex flex-col gap-2">
      {points.length === 4 && (
        <div className="grid grid-cols-4 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1">
              <Label className="text-[9px] font-mono text-muted-foreground">P{i + 1} (m)</Label>
              <div className="flex gap-1">
                <Input
                  type="number" step="0.01" placeholder="X"
                  value={worldCoords[i].x}
                  onChange={(e) => {
                    const next = [...worldCoords];
                    next[i] = { ...next[i], x: e.target.value };
                    setWorldCoords(next);
                  }}
                  className="w-16 h-6 text-[10px] font-mono"
                />
                <Input
                  type="number" step="0.01" placeholder="Y"
                  value={worldCoords[i].y}
                  onChange={(e) => {
                    const next = [...worldCoords];
                    next[i] = { ...next[i], y: e.target.value };
                    setWorldCoords(next);
                  }}
                  className="w-16 h-6 text-[10px] font-mono"
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-[10px] font-mono text-destructive">{error}</p>}
      <div className="flex gap-2">
        {points.length === 4 && (
          <Button size="sm" className="h-7 gap-1 text-xs font-mono" onClick={apply}>
            <Check className="w-3 h-3" /> Apply Homography
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs font-mono" onClick={reset}>
          <X className="w-3 h-3" /> Cancel
        </Button>
      </div>
    </div>
  ) : null;

  const triggerButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => { setIsCalibrating(true); setPoints([]); setError(null); }}
      className="gap-1.5 font-mono text-xs shrink-0"
    >
      <Grid3X3 className="w-3 h-3" />
      Homography
    </Button>
  );

  return { isCalibrating, overlay, controls, triggerButton };
}

export default useHomographyCalibration;

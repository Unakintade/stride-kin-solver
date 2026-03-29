import React, { useState, useRef, useCallback } from "react";
import { Crosshair, X, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PixelPoint } from "@/lib/biomechanics/cameraStabilization";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>;
  videoWidth: number;
  videoHeight: number;
  disabled?: boolean;
  onPointSelected: (point: PixelPoint | null) => void;
  selectedPoint: PixelPoint | null;
}

const ReferencePointSelector: React.FC<Props> = ({
  videoRef,
  videoWidth,
  videoHeight,
  disabled,
  onPointSelected,
  selectedPoint,
}) => {
  const [isSelecting, setIsSelecting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isSelecting || !overlayRef.current) return;

      const rect = overlayRef.current.getBoundingClientRect();
      const scaleX = videoWidth / rect.width;
      const scaleY = videoHeight / rect.height;

      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;

      onPointSelected({ x: px, y: py });
      setIsSelecting(false);
    },
    [isSelecting, videoWidth, videoHeight, onPointSelected],
  );

  const triggerButton = (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 font-mono text-[11px] h-7"
      disabled={disabled}
      onClick={() => {
        if (selectedPoint) {
          onPointSelected(null);
        } else {
          // Seek video to frame 0 so user picks from the first frame
          if (videoRef.current) videoRef.current.currentTime = 0;
          setIsSelecting(true);
        }
      }}
    >
      {selectedPoint ? (
        <>
          <X className="w-3 h-3" /> Clear Ref
        </>
      ) : (
        <>
          <Crosshair className="w-3 h-3" /> Pan Ref
        </>
      )}
    </Button>
  );

  const overlay = isSelecting ? (
    <div
      ref={overlayRef}
      onClick={handleClick}
      className="absolute inset-0 z-30 cursor-crosshair bg-primary/10 flex items-center justify-center"
    >
      <div className="bg-background/90 border border-border rounded px-3 py-2 text-center pointer-events-none">
        <p className="text-xs font-mono text-foreground font-semibold">
          Click a stationary object
        </p>
        <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
          e.g. a cone, post, lane marking, or sign
        </p>
      </div>
    </div>
  ) : null;

  const badge = selectedPoint ? (
    <div className="flex items-center gap-1.5 text-[10px] font-mono text-primary">
      <Video className="w-3 h-3" />
      <span>
        Pan ref: ({Math.round(selectedPoint.x)}, {Math.round(selectedPoint.y)})
        — camera motion will be compensated
      </span>
    </div>
  ) : null;

  return { triggerButton, overlay, badge };
};

/**
 * Hook wrapper for cleaner integration (same pattern as VideoCalibration).
 */
export default function useReferencePointSelector(props: Props) {
  return ReferencePointSelector(props);
}

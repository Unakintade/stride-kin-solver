import React, { useCallback } from "react";
import { Upload, Film, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onVideoSelected: (file: File) => void;
  isProcessing: boolean;
}

const VideoUploader: React.FC<Props> = ({ onVideoSelected, isProcessing }) => {
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith("video/")) onVideoSelected(file);
    },
    [onVideoSelected]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onVideoSelected(file);
    },
    [onVideoSelected]
  );

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      className={`relative border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
        isProcessing
          ? "border-primary/30 bg-primary/5 pointer-events-none opacity-60"
          : "border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer"
      }`}
    >
      <input
        type="file"
        accept="video/*"
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        disabled={isProcessing}
      />
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
          <Film className="w-7 h-7 text-primary" />
        </div>
        <div>
          <p className="text-foreground font-medium text-lg">
            Drop a sprint video here
          </p>
          <p className="text-muted-foreground text-sm mt-1">
            MP4, MOV, or WebM • <strong>120+ fps</strong> recommended for sprint analysis
          </p>
          <p className="text-muted-foreground text-xs mt-0.5">
            Side or diagonal framing, stable camera. 240 fps ideal for foot-strike detail.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <Zap className="w-3.5 h-3.5 text-accent" />
          <span>BlazePose + Kalman Filter + Kinematic Analysis</span>
        </div>
      </div>
    </div>
  );
};

export default VideoUploader;

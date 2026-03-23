import React, { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, ArrowLeft, Play, Pause, SkipForward, SkipBack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import VideoUploader from "@/components/VideoUploader";
import PipelineStatus from "@/components/PipelineStatus";
import SkeletonCanvas from "@/components/SkeletonCanvas";
import ResultsDashboard from "@/components/ResultsDashboard";
import type { FrameLandmarks, FrameResult, PipelineStage } from "@/lib/biomechanics/types";
import { detectPoseInVideo } from "@/lib/biomechanics/detection";
import { smoothLandmarks } from "@/lib/biomechanics/filtering";
import { computeKinematics, computeAnthropometry } from "@/lib/biomechanics/kinematics";

const INITIAL_STAGES: PipelineStage[] = [
  { id: "detection", name: "Detection", description: "BlazePose", status: "pending", progress: 0 },
  { id: "filtering", name: "Filtering", description: "Kalman", status: "pending", progress: 0 },
  { id: "kinematics", name: "Kinematics", description: "IK", status: "pending", progress: 0 },
  { id: "results", name: "Results", description: "Export", status: "pending", progress: 0 },
];

const Analyze: React.FC = () => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState({ width: 640, height: 480 });
  const [fps, setFps] = useState(30);
  const [maxFrames, setMaxFrames] = useState(0); // 0 = no limit
  const [isProcessing, setIsProcessing] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>(INITIAL_STAGES);
  const [rawLandmarks, setRawLandmarks] = useState<FrameLandmarks[]>([]);
  const [filteredLandmarks, setFilteredLandmarks] = useState<FrameLandmarks[]>([]);
  const [results, setResults] = useState<FrameResult[]>([]);
  const [anthropometry, setAnthropometry] = useState<Record<string, number>>({});
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const animRef = useRef<number>(0);

  const updateStage = useCallback((id: string, updates: Partial<PipelineStage>) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  }, []);

  const handleVideoSelected = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setStages(INITIAL_STAGES);
    setRawLandmarks([]);
    setFilteredLandmarks([]);
    setResults([]);
    setCurrentFrame(0);
  }, []);

  const handleVideoLoaded = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
  }, []);

  const runPipeline = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    setIsProcessing(true);
    setCurrentFrame(0);

    try {
      // Stage 1: Detection
      updateStage("detection", { status: "active", progress: 0 });
      const detected = await detectPoseInVideo(
        video,
        fps,
        (progress) => updateStage("detection", { progress }),
        maxFrames > 0 ? maxFrames : undefined
      );
      setRawLandmarks(detected);
      updateStage("detection", { status: "complete", progress: 1 });

      if (detected.length === 0) {
        updateStage("filtering", { status: "error" });
        throw new Error("No poses detected in video");
      }

      // Stage 2: Filtering
      updateStage("filtering", { status: "active", progress: 0 });
      const filtered = smoothLandmarks(detected, fps, (progress) =>
        updateStage("filtering", { progress })
      );
      setFilteredLandmarks(filtered);
      updateStage("filtering", { status: "complete", progress: 1 });

      // Stage 3: Kinematics
      updateStage("kinematics", { status: "active", progress: 0 });
      const kinResults = computeKinematics(filtered, fps, (progress) =>
        updateStage("kinematics", { progress })
      );
      setResults(kinResults);
      updateStage("kinematics", { status: "complete", progress: 1 });

      // Anthropometry
      const anthro = computeAnthropometry(filtered);
      setAnthropometry(anthro);

      // Stage 4: Results
      updateStage("results", { status: "complete", progress: 1 });
    } catch (err: any) {
      console.error("Pipeline error:", err);
      setStages((prev) =>
        prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s))
      );
    } finally {
      setIsProcessing(false);
    }
  }, [videoUrl, fps, maxFrames, updateStage]);

  // Playback animation
  useEffect(() => {
    if (!isPlaying || filteredLandmarks.length === 0) return;
    let lastTime = performance.now();
    const interval = 1000 / fps;

    const tick = (now: number) => {
      if (now - lastTime >= interval) {
        lastTime = now;
        setCurrentFrame((f) => {
          const next = f + 1;
          if (next >= filteredLandmarks.length) {
            setIsPlaying(false);
            return f;
          }
          return next;
        });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, fps, filteredLandmarks.length]);

  const currentLandmark = filteredLandmarks[currentFrame] || null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-50">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <span className="font-mono text-sm font-semibold">Analyzer</span>
            </div>
          </div>
          <PipelineStatus stages={stages} />
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {!videoUrl ? (
          <VideoUploader onVideoSelected={handleVideoSelected} isProcessing={isProcessing} />
        ) : (
          <>
            {/* Controls */}
            <Card className="bg-card border-border">
              <CardContent className="p-4 flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-mono text-muted-foreground">FPS</Label>
                  <Input
                    type="number"
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                    className="w-24 h-8 text-sm font-mono"
                    disabled={isProcessing}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-mono text-muted-foreground">Max Frames</Label>
                  <Input
                    type="number"
                    value={maxFrames}
                    onChange={(e) => setMaxFrames(Number(e.target.value))}
                    className="w-24 h-8 text-sm font-mono"
                    disabled={isProcessing}
                  />
                </div>
                <Button
                  onClick={runPipeline}
                  disabled={isProcessing}
                  className="gap-2 font-mono text-xs"
                >
                  <Activity className="w-3.5 h-3.5" />
                  {isProcessing ? "Processing..." : "Run Pipeline"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setVideoUrl(null);
                    setStages(INITIAL_STAGES);
                    setRawLandmarks([]);
                    setFilteredLandmarks([]);
                    setResults([]);
                  }}
                  className="font-mono text-xs"
                  disabled={isProcessing}
                >
                  Reset
                </Button>
              </CardContent>
            </Card>

            {/* Video + Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="bg-card border-border overflow-hidden">
                <div className="relative" style={{ width: displayWidth, height: displayHeight }}>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    onLoadedMetadata={handleVideoLoaded}
                    className="w-full h-full object-contain bg-background"
                    crossOrigin="anonymous"
                    playsInline
                    muted
                  />
                  <SkeletonCanvas
                    landmarks={currentLandmark}
                    width={displayWidth}
                    height={displayHeight}
                    showLabels
                  />
                </div>

                {/* Playback controls */}
                {filteredLandmarks.length > 0 && (
                  <div className="p-3 border-t border-border space-y-2">
                    <div className="flex items-center gap-2">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCurrentFrame(0)}>
                        <SkipBack className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setIsPlaying(!isPlaying)}
                      >
                        {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setCurrentFrame(filteredLandmarks.length - 1)}
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                      </Button>
                      <Slider
                        value={[currentFrame]}
                        onValueChange={([v]) => { setIsPlaying(false); setCurrentFrame(v); }}
                        max={filteredLandmarks.length - 1}
                        step={1}
                        className="flex-1"
                      />
                      <span className="text-[10px] font-mono text-muted-foreground w-24 text-right">
                        {currentFrame}/{filteredLandmarks.length - 1} • {currentLandmark?.timestamp.toFixed(3)}s
                      </span>
                    </div>
                  </div>
                )}
              </Card>

              {/* Live stats for current frame */}
              {results.length > 0 && results[currentFrame] && (
                <Card className="bg-card border-border">
                  <CardContent className="p-4 space-y-3">
                    <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                      Frame {currentFrame} — {results[currentFrame].timestamp.toFixed(3)}s
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {results[currentFrame].jointAngles.map((j, i) => (
                        <div key={i} className="bg-secondary rounded p-2">
                          <p className="text-[9px] font-mono text-muted-foreground truncate">{j.name}</p>
                          <p className="text-sm font-semibold text-foreground">
                            {j.angleDeg.toFixed(1)}°
                          </p>
                          <p className="text-[9px] font-mono text-primary/70">
                            {j.velocityRadS.toFixed(2)} rad/s
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                      <div className="bg-secondary rounded p-2">
                        <p className="text-[9px] font-mono text-muted-foreground">Stride Length</p>
                        <p className="text-sm font-semibold text-foreground">
                          {results[currentFrame].strideLength.toFixed(3)} m
                        </p>
                      </div>
                      <div className="bg-secondary rounded p-2">
                        <p className="text-[9px] font-mono text-muted-foreground">CoM Speed</p>
                        <p className="text-sm font-semibold text-foreground">
                          {Math.sqrt(
                            results[currentFrame].comVelocity.reduce((s, v) => s + v * v, 0)
                          ).toFixed(3)}{" "}
                          m/s
                        </p>
                      </div>
                    </div>
                    {results[currentFrame].warnings.length > 0 && (
                      <div className="bg-destructive/10 border border-destructive/20 rounded p-2">
                        {results[currentFrame].warnings.map((w, i) => (
                          <p key={i} className="text-[10px] font-mono text-destructive">{w}</p>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Results dashboard */}
            {results.length > 0 && (
              <ResultsDashboard results={results} anthropometry={anthropometry} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Analyze;

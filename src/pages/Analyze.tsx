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
import useVideoCalibration from "@/components/VideoCalibration";
import ResultsDashboard from "@/components/ResultsDashboard";
import MuJoCoPanel from "@/components/MuJoCoPanel";
import Skeleton3DViewer from "@/components/Skeleton3DViewer";
import MuJoCoCharts from "@/components/MuJoCoCharts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import type { FrameLandmarks, FrameResult, PipelineStage } from "@/lib/biomechanics/types";
import type { MuJoCoSolveResponse } from "@/lib/biomechanics/mujocoApi";
import { detectPoseInVideo } from "@/lib/biomechanics/detection";
import { smoothLandmarks } from "@/lib/biomechanics/filtering";
import { computeKinematics, computeAnthropometry } from "@/lib/biomechanics/kinematics";
import {
  LOW_FPS_WARNING_THRESHOLD,
  RECOMMENDED_SPRINT_CAPTURE_FPS,
} from "@/lib/biomechanics/constants";
import { inferVideoFrameRate } from "@/lib/biomechanics/video";

const INITIAL_STAGES: PipelineStage[] = [
  { id: "detection", name: "Vision", description: "BlazePose", status: "pending", progress: 0 },
  { id: "filtering", name: "Filtering", description: "CA-KF + RTS", status: "pending", progress: 0 },
  {
    id: "kinematics",
    name: "Kinematics",
    description: "Joint geometry",
    status: "pending",
    progress: 0,
  },
  { id: "results", name: "Results", description: "Export", status: "pending", progress: 0 },
];

const Analyze: React.FC = () => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState({ width: 640, height: 480 });
  const [fps, setFps] = useState(30);
  const [inferredFps, setInferredFps] = useState<number | null>(null);
  const [fieldWidthMeters, setFieldWidthMeters] = useState("");
  const [useRtsSmoother, setUseRtsSmoother] = useState(true);
  const [maxFrames, setMaxFrames] = useState(0); // 0 = no limit
  const [playbackDuration, setPlaybackDuration] = useState(2); // seconds
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [stages, setStages] = useState<PipelineStage[]>(INITIAL_STAGES);
  const [rawLandmarks, setRawLandmarks] = useState<FrameLandmarks[]>([]);
  const [filteredLandmarks, setFilteredLandmarks] = useState<FrameLandmarks[]>([]);
  const [results, setResults] = useState<FrameResult[]>([]);
  const [anthropometry, setAnthropometry] = useState<Record<string, number>>({});
  const [mujocoData, setMujocoData] = useState<MuJoCoSolveResponse | null>(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const animRef = useRef<number>(0);

  const calibration = useVideoCalibration({
    videoWidth: videoDimensions.width,
    videoHeight: videoDimensions.height,
    onCalibrated: (fw) => setFieldWidthMeters(fw.toFixed(2)),
  });

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
    setInferredFps(null);
    const tryInfer = () => {
      void inferVideoFrameRate(video).then((rate) => {
        if (rate != null && rate > 0) {
          setInferredFps(rate);
          setFps((prev) => (prev === 30 ? Math.round(rate) : prev));
        }
      });
    };
    tryInfer();
    window.setTimeout(tryInfer, 250);
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
      const filtered = smoothLandmarks(
        detected,
        fps,
        (progress) => updateStage("filtering", { progress }),
        { useRtsSmoother }
      );
      setFilteredLandmarks(filtered);
      updateStage("filtering", { status: "complete", progress: 1 });

      // Stage 3: Kinematics
      updateStage("kinematics", { status: "active", progress: 0 });
      const fw = fieldWidthMeters.trim();
      const fieldM = fw === "" ? NaN : Number(fw);
      const kinResults = computeKinematics(
        filtered,
        fps,
        (progress) => updateStage("kinematics", { progress }),
        {
          metricCalibration:
            Number.isFinite(fieldM) &&
            fieldM > 0 &&
            video.videoWidth > 0 &&
            video.videoHeight > 0
              ? {
                  fieldWidthMeters: fieldM,
                  videoWidthPx: video.videoWidth,
                  videoHeightPx: video.videoHeight,
                }
              : null,
        }
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
  }, [videoUrl, fps, maxFrames, updateStage, useRtsSmoother, fieldWidthMeters]);

  // Playback animation
  useEffect(() => {
    if (!isPlaying || filteredLandmarks.length === 0) return;
    let lastTime = performance.now();
    const interval = (playbackDuration * 1000) / filteredLandmarks.length;

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
  }, [isPlaying, playbackDuration, filteredLandmarks.length]);

  const currentLandmark = filteredLandmarks[currentFrame] || null;

  // Sync video element to current frame timestamp
  useEffect(() => {
    const video = videoRef.current;
    if (video && currentLandmark && !isProcessing) {
      video.currentTime = currentLandmark.timestamp;
    }
  }, [currentFrame, currentLandmark, isProcessing]);

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
              <CardContent className="p-4 flex flex-col gap-4">
                {fps > 0 && fps < LOW_FPS_WARNING_THRESHOLD && (
                  <Alert className="border-amber-500/40 bg-amber-500/10 text-foreground">
                    <AlertTitle className="font-mono text-xs">Low sampling rate</AlertTitle>
                    <AlertDescription className="font-mono text-[11px] text-muted-foreground">
                      At {fps} Hz, fast limb motion is often undersampled. Prefer{" "}
                      {RECOMMENDED_SPRINT_CAPTURE_FPS} Hz or higher for sprint-style capture when
                      possible.
                    </AlertDescription>
                  </Alert>
                )}
                {fps >= LOW_FPS_WARNING_THRESHOLD && fps < RECOMMENDED_SPRINT_CAPTURE_FPS && (
                  <Alert className="border-border bg-secondary/50">
                    <AlertTitle className="font-mono text-xs">Capture rate</AlertTitle>
                    <AlertDescription className="font-mono text-[11px] text-muted-foreground">
                      For explosive sprinting, {RECOMMENDED_SPRINT_CAPTURE_FPS}+ fps is recommended;
                      current setting ({fps} Hz) may still blur feet at foot strike.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1">
                  <Label className="text-xs font-mono text-muted-foreground">FPS</Label>
                  <Input
                    type="number"
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                    className="w-24 h-8 text-sm font-mono"
                    disabled={isProcessing}
                  />
                  {inferredFps != null && (
                    <p className="text-[10px] font-mono text-muted-foreground max-w-[10rem]">
                      Track ~{inferredFps.toFixed(0)} Hz (if reported by browser)
                    </p>
                  )}
                </div>
                <div className="space-y-1 flex-1 min-w-[12rem]">
                  <Label className="text-xs font-mono text-muted-foreground">
                    Field width (m)
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 10"
                      value={fieldWidthMeters}
                      onChange={(e) => setFieldWidthMeters(e.target.value)}
                      className="h-8 text-sm font-mono flex-1"
                      disabled={isProcessing}
                    />
                    {!calibration.isCalibrating && calibration.triggerButton}
                  </div>
                  {calibration.controls}
                  <p className="text-[10px] font-mono text-muted-foreground">
                    Enter manually, or click "Calibrate" to measure from two points on the video.
                    Leave empty for automatic scale from limb ratios.
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <Checkbox
                    id="rts"
                    checked={useRtsSmoother}
                    onCheckedChange={(c) => setUseRtsSmoother(c === true)}
                    disabled={isProcessing}
                  />
                  <Label htmlFor="rts" className="text-xs font-mono cursor-pointer">
                    RTS smoother (offline)
                  </Label>
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
                <div className="space-y-1">
                  <Label className="text-xs font-mono text-muted-foreground">Height (cm)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="50"
                    max="250"
                    placeholder="175"
                    value={heightCm}
                    onChange={(e) => setHeightCm(e.target.value)}
                    className="w-24 h-8 text-sm font-mono"
                    disabled={isProcessing}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-mono text-muted-foreground">Weight (kg)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="20"
                    max="300"
                    placeholder="75"
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    className="w-24 h-8 text-sm font-mono"
                    disabled={isProcessing}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-mono text-muted-foreground">
                    Playback (s)
                  </Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="60"
                    value={playbackDuration}
                    onChange={(e) => setPlaybackDuration(Math.max(0.5, Number(e.target.value)))}
                    className="w-24 h-8 text-sm font-mono"
                  />
                  {filteredLandmarks.length > 0 && (
                    <p className="text-[10px] font-mono text-muted-foreground max-w-[14rem]">
                      {filteredLandmarks.length} frames over {playbackDuration}s →{" "}
                      {(filteredLandmarks.length / playbackDuration).toFixed(1)} fps playback
                      {fps > 0 && (
                        <span>
                          {" "}({(playbackDuration / (filteredLandmarks.length / fps)).toFixed(2)}× real-time)
                        </span>
                      )}
                    </p>
                  )}
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
                    setInferredFps(null);
                    setMujocoData(null);
                    setFieldWidthMeters("");
                  }}
                  className="font-mono text-xs"
                  disabled={isProcessing}
                >
                  Reset
                </Button>
                </div>
              </CardContent>
            </Card>

            {/* Video + Skeleton */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="bg-card border-border overflow-hidden">
                <div className="relative w-full" style={{ aspectRatio: `${videoDimensions.width} / ${videoDimensions.height}` }}>
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
                    width={videoDimensions.width}
                    height={videoDimensions.height}
                    showLabels
                  />
                  {calibration.overlay}
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
              <>
                <ResultsDashboard results={results} anthropometry={anthropometry} />
                <MuJoCoPanel
                  filteredLandmarks={filteredLandmarks}
                  fps={fps}
                  anthropometry={anthropometry}
                  weightKg={weightKg.trim() !== "" ? Number(weightKg) : undefined}
                  heightCm={heightCm.trim() !== "" ? Number(heightCm) : undefined}
                  onSolveComplete={setMujocoData}
                />
                <Skeleton3DViewer
                  mujocoData={mujocoData}
                  landmarks={filteredLandmarks}
                  fps={fps}
                />
                {mujocoData && (
                  <MuJoCoCharts mujocoData={mujocoData} fps={fps} />
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Analyze;

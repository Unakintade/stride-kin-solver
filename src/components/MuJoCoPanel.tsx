import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, Server, Loader2, AlertTriangle, Zap } from "lucide-react";
import type { FrameLandmarks } from "@/lib/biomechanics/types";
import {
  checkMuJoCoHealth,
  solveMuJoCo,
  getMuJoCoBackendUrl,
  setMuJoCoBackendUrl,
  type MuJoCoSolveResponse,
} from "@/lib/biomechanics/mujocoApi";

interface Props {
  filteredLandmarks?: FrameLandmarks[];
  fps?: number;
  anthropometry?: Record<string, number>;
  weightKg?: number;
  heightCm?: number;
}

const MuJoCoPanel: React.FC<Props> = ({
  filteredLandmarks,
  fps,
  anthropometry,
  weightKg,
  heightCm,
}) => {
  const landmarks = filteredLandmarks ?? [];
  const safeFps = fps ?? 30;

  const [backendUrl, setBackendUrlLocal] = useState(getMuJoCoBackendUrl());
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [response, setResponse] = useState<MuJoCoSolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check health on mount and URL change
  useEffect(() => {
    setIsOnline(null);
    checkMuJoCoHealth().then(setIsOnline);
  }, [backendUrl]);

  const handleUrlChange = (url: string) => {
    setBackendUrlLocal(url);
    setMuJoCoBackendUrl(url);
  };

  const handleSolve = async () => {
    if (landmarks.length < 2) return;
    setIsSolving(true);
    setError(null);
    setProgress(0);
    try {
      const result = await solveMuJoCo(
        landmarks, safeFps, anthropometry, setProgress, weightKg, heightCm
      );
      setResponse(result);
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setIsSolving(false);
    }
  };

  const handleExportCSV = () => {
    if (!response?.frames?.length) return;
    const frames = response.frames;

    const jointNames = Object.keys(frames[0]?.joints ?? {});
    const headers = [
      "timestamp", "frame_idx",
      ...jointNames.flatMap((jn) => [`${jn}_angle_deg`, `${jn}_vel_rad_s`, `${jn}_torque_nm`]),
      "com_x", "com_y", "com_z",
      "com_vel_x", "com_vel_y", "com_vel_z",
      "grf_left_x", "grf_left_y", "grf_left_z",
      "grf_right_x", "grf_right_y", "grf_right_z",
      "residual_m",
    ];

    const rows = frames.map((f) => [
      f.timestamp, f.frame_idx,
      ...jointNames.flatMap((jn) => {
        const j = f.joints?.[jn];
        return [j?.angle_deg ?? 0, j?.velocity_rad_s ?? 0, j?.torque_nm ?? 0];
      }),
      ...(f.com_position ?? [0, 0, 0]),
      ...(f.com_velocity ?? [0, 0, 0]),
      ...(f.grf_left ?? [0, 0, 0]),
      ...(f.grf_right ?? [0, 0, 0]),
      f.residual_error ?? 0,
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mujoco_kinetics.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const frames = response?.frames ?? [];
  const summary = response?.summary;
  const firstFrame = frames[0];

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono text-foreground flex items-center gap-2">
          <Server className="w-4 h-4 text-primary" />
          MuJoCo Physics Backend
          {isOnline === true && <Badge variant="outline" className="text-[10px] text-green-400 border-green-400/40">Online</Badge>}
          {isOnline === false && <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">Offline</Badge>}
          {isOnline === null && <Badge variant="outline" className="text-[10px] text-muted-foreground">Checking…</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Backend URL */}
        <div className="flex items-end gap-2">
          <div className="space-y-1 flex-1">
            <Label className="text-xs font-mono text-muted-foreground">Backend URL</Label>
            <Input
              value={backendUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="http://localhost:8000"
              className="h-8 text-sm font-mono"
              disabled={isSolving}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setIsOnline(null); checkMuJoCoHealth().then(setIsOnline); }}
            disabled={isSolving}
            className="font-mono text-xs"
          >
            Test
          </Button>
        </div>

        {/* Solve button */}
        <div className="flex items-center gap-3">
          <Button
            onClick={handleSolve}
            disabled={isSolving || !isOnline || landmarks.length < 2}
            className="gap-2 font-mono text-xs"
          >
            {isSolving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Solving… {(progress * 100).toFixed(0)}%
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5" />
                Run MuJoCo IK + Inverse Dynamics
              </>
            )}
          </Button>
          {frames.length > 0 && (
            <Button size="sm" variant="outline" onClick={handleExportCSV} className="gap-1.5 font-mono text-xs">
              <Download className="w-3.5 h-3.5" /> Export Kinetics CSV
            </Button>
          )}
        </div>

        {/* Progress bar */}
        {isSolving && (
          <div className="w-full bg-secondary rounded-full h-1.5">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded p-3">
            <p className="text-xs font-mono text-destructive flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </p>
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: "Frames", value: summary.total_frames },
                { label: "Solve Time", value: `${summary.solve_time_s}s` },
                { label: "Mean Residual", value: `${((summary.mean_residual_m ?? 0) * 100).toFixed(1)} cm` },
                { label: "Max Residual", value: `${((summary.max_residual_m ?? 0) * 100).toFixed(1)} cm` },
                { label: "Warnings", value: summary.total_warnings },
              ].map((s, i) => (
                <div key={i} className="bg-secondary rounded-md p-3">
                  <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{s.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-1">{s.value}</p>
                </div>
              ))}
            </div>

            {/* Sample frame data */}
            {firstFrame?.joints && (
              <div className="space-y-2">
                <p className="text-xs font-mono text-muted-foreground">
                  Joint Torques (frame 0):
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(firstFrame.joints).slice(0, 8).map(([name, j]) => (
                    <div key={name} className="bg-secondary rounded p-2">
                      <p className="text-[9px] font-mono text-muted-foreground truncate">{name}</p>
                      <p className="text-sm font-semibold text-foreground">{(j?.torque_nm ?? 0).toFixed(1)} Nm</p>
                      <p className="text-[9px] font-mono text-primary/70">{(j?.velocity_rad_s ?? 0).toFixed(2)} rad/s</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!isOnline && (
          <p className="text-[10px] font-mono text-muted-foreground">
            Start the MuJoCo backend with <code className="bg-secondary px-1 rounded">docker-compose up</code> to enable physics-constrained analysis.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default MuJoCoPanel;

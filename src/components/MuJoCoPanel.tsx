import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, Server, Loader2, AlertTriangle, Zap, ChevronDown, ChevronUp, Bug } from "lucide-react";
import type { FrameLandmarks } from "@/lib/biomechanics/types";
import {
  checkMuJoCoHealth,
  solveMuJoCo,
  getMuJoCoBackendUrl,
  setMuJoCoBackendUrl,
  twoMassStanceLabel,
  type MuJoCoSolveResponse,
} from "@/lib/biomechanics/mujocoApi";

interface Props {
  filteredLandmarks?: FrameLandmarks[];
  fps?: number;
  anthropometry?: Record<string, number>;
  weightKg?: number;
  heightCm?: number;
  onSolveComplete?: (response: MuJoCoSolveResponse) => void;
}

const MuJoCoPanel: React.FC<Props> = ({
  filteredLandmarks,
  fps,
  anthropometry,
  weightKg,
  heightCm,
  onSolveComplete,
}) => {
  const landmarks = filteredLandmarks ?? [];
  const safeFps = fps ?? 30;

  const [backendUrl, setBackendUrlLocal] = useState(getMuJoCoBackendUrl());
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [response, setResponse] = useState<MuJoCoSolveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRawResponse, setShowRawResponse] = useState(false);

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
    setResponse(null);
    try {
      const result = await solveMuJoCo(
        landmarks, safeFps, anthropometry, setProgress, weightKg, heightCm
      );
      setResponse(result);
      onSolveComplete?.(result);
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

  const stanceBreakdown = useMemo(() => {
    if (!frames.some((f) => f.two_mass_stance != null)) return null;
    const c = { none: 0, l: 0, r: 0, double: 0 };
    for (const f of frames) {
      const k = f.two_mass_stance;
      if (k === "none" || k === "l" || k === "r" || k === "double") c[k]++;
    }
    return { c, n: frames.length };
  }, [frames]);
  
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono text-foreground flex items-center gap-2">
          <Server className="w-4 h-4 text-primary" />
          Biomechanics backend
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
                Run kinetics solve
              </>
            )}
          </Button>
          {frames.length > 0 && (
            <Button size="sm" variant="outline" onClick={handleExportCSV} className="gap-1.5 font-mono text-xs">
              <Download className="w-3.5 h-3.5" /> Export CSV
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
            <p className="text-xs font-mono text-destructive flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="break-all whitespace-pre-wrap">{error}</span>
            </p>
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Frames", value: summary.total_frames },
                { label: "Solve Time", value: `${summary.solve_time_s}s` },
                { label: "Mean Residual", value: `${((summary.mean_residual_m ?? 0) * 100).toFixed(1)} cm` },
                { label: "Warnings", value: summary.total_warnings },
              ].map((s, i) => (
                <div key={i} className="bg-secondary rounded-md p-3">
                  <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">{s.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-1">{s.value}</p>
                </div>
              ))}
            </div>

            {/* Sample frame data */}
            {(firstFrame?.two_mass_stance != null || stanceBreakdown) && (
              <div className="space-y-2 rounded-md border border-border/60 bg-secondary/40 p-3">
                <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  two_mass_stance
                </p>
                {firstFrame?.two_mass_stance != null && (
                  <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                    <span className="text-muted-foreground">Frame 0:</span>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {twoMassStanceLabel(firstFrame.two_mass_stance)}
                    </Badge>
                    {firstFrame.vgrf_model && (
                      <span className="text-[10px] text-muted-foreground">({firstFrame.vgrf_model})</span>
                    )}
                  </div>
                )}
                {stanceBreakdown && (
                  <p className="text-[10px] font-mono text-foreground leading-relaxed">
                    Clip: flight {Math.round((100 * stanceBreakdown.c.none) / stanceBreakdown.n)}% · left{" "}
                    {Math.round((100 * stanceBreakdown.c.l) / stanceBreakdown.n)}% · right{" "}
                    {Math.round((100 * stanceBreakdown.c.r) / stanceBreakdown.n)}% · double{" "}
                    {Math.round((100 * stanceBreakdown.c.double) / stanceBreakdown.n)}%
                  </p>
                )}
              </div>
            )}
            
            {firstFrame?.joints && Object.keys(firstFrame.joints).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-mono text-muted-foreground">
                  Joint data (frame 0):
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(firstFrame.joints).slice(0, 8).map(([name, j]) => (
                    <div key={name} className="bg-secondary rounded p-2">
                      <p className="text-[9px] font-mono text-muted-foreground truncate">{name}</p>
                      <p className="text-sm font-semibold text-foreground">{(j?.angle_deg ?? 0).toFixed(1)}°</p>
                      {(j?.torque_nm ?? 0) !== 0 && (
                        <p className="text-[9px] font-mono text-primary/70">{j.torque_nm.toFixed(1)} Nm</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Raw response viewer */}
        {response?._raw && (
          <div className="space-y-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowRawResponse(!showRawResponse)}
              className="gap-1.5 font-mono text-xs text-muted-foreground h-7 px-2"
            >
              <Bug className="w-3.5 h-3.5" />
              Raw Backend Response
              {showRawResponse ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
            {showRawResponse && (
              <pre className="bg-secondary rounded p-3 text-[10px] font-mono text-foreground overflow-auto max-h-64 whitespace-pre-wrap break-all">
                {JSON.stringify(response._raw, null, 2)}
              </pre>
            )}
          </div>
        )}

        {!isOnline && (
          <p className="text-[10px] font-mono text-muted-foreground">
            Start from <code className="bg-secondary px-1 rounded">biomech-worker</code>:{" "}
            <code className="bg-secondary px-1 rounded">uvicorn app.main:app --host 0.0.0.0 --port 8000</code> (requires the <code className="bg-secondary px-1 rounded">mujoco</code> Python package).
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default MuJoCoPanel;

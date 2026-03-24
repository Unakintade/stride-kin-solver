import React, { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ReferenceLine,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, AlertTriangle, Activity, TrendingUp, Footprints } from "lucide-react";
import type { FrameResult } from "@/lib/biomechanics/types";
import { exportCSV } from "@/lib/biomechanics/kinematics";

interface Props {
  results: FrameResult[];
  anthropometry: Record<string, number>;
}

const CHART_COLORS = [
  "hsl(160, 70%, 45%)", "hsl(210, 80%, 55%)", "hsl(35, 90%, 55%)",
  "hsl(0, 72%, 55%)", "hsl(270, 60%, 60%)",
];

const ResultsDashboard: React.FC<Props> = ({ results, anthropometry }) => {
  const allWarnings = useMemo(
    () => results.flatMap((r) => r.warnings.map((w) => ({ timestamp: r.timestamp, warning: w }))),
    [results]
  );

  const jointAngleData = useMemo(() => {
    return results.map((r) => {
      const row: Record<string, number> = { time: r.timestamp };
      r.jointAngles.forEach((j) => {
        row[j.name] = Number(j.angleDeg.toFixed(1));
      });
      return row;
    });
  }, [results]);

  const velocityData = useMemo(() => {
    return results.map((r) => {
      const row: Record<string, number> = { time: r.timestamp };
      r.jointAngles.forEach((j) => {
        row[j.name] = Number(Math.abs(j.velocityRadS).toFixed(2));
      });
      return row;
    });
  }, [results]);

  const angVelData = useMemo(() => {
    return results.map((r) => {
      const row: Record<string, number> = { time: r.timestamp };
      r.jointAngles.forEach((j) => {
        row[j.name] = Number(j.velocityRadS.toFixed(2));
      });
      return row;
    });
  }, [results]);

  const peakAngVel = useMemo(() => {
    const peaks: Record<string, number> = {};
    results.forEach((r) => {
      r.jointAngles.forEach((j) => {
        const abs = Math.abs(j.velocityRadS);
        if (!peaks[j.name] || abs > peaks[j.name]) peaks[j.name] = abs;
      });
    });
    return peaks;
  }, [results]);

  const strideData = useMemo(
    () => results.map((r) => ({ time: r.timestamp, stride: Number(r.strideLength.toFixed(3)) })),
    [results]
  );

  const comData = useMemo(
    () =>
      results.map((r) => ({
        time: r.timestamp,
        speed: Number(
          Math.sqrt(r.comVelocity[0] ** 2 + r.comVelocity[1] ** 2 + r.comVelocity[2] ** 2).toFixed(3)
        ),
      })),
    [results]
  );

  const stats = useMemo(() => {
    const avgStride = results.reduce((s, r) => s + r.strideLength, 0) / results.length;
    const maxSpeed = Math.max(...comData.map((d) => d.speed));
    const avgSpeed = comData.reduce((s, d) => s + d.speed, 0) / comData.length;
    return { avgStride, maxSpeed, avgSpeed, totalFrames: results.length, warnings: allWarnings.length };
  }, [results, comData, allWarnings]);

  const handleExport = () => {
    const csv = exportCSV(results);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kinematics.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectedJoints = [
    "Left Knee Extension", "Right Knee Extension",
    "Left Hip Flexion", "Right Hip Flexion",
  ];

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Frames", value: stats.totalFrames, icon: <Activity className="w-4 h-4" /> },
          { label: "Avg Stride", value: `${stats.avgStride.toFixed(2)}m`, icon: <Footprints className="w-4 h-4" /> },
          { label: "Max Speed", value: `${stats.maxSpeed.toFixed(2)} m/s`, icon: <TrendingUp className="w-4 h-4" /> },
          { label: "Avg Speed", value: `${stats.avgSpeed.toFixed(2)} m/s`, icon: <TrendingUp className="w-4 h-4" /> },
          {
            label: "Warnings",
            value: stats.warnings,
            icon: <AlertTriangle className="w-4 h-4" />,
            variant: stats.warnings > 0 ? "warn" : "ok",
          },
        ].map((s, i) => (
          <Card key={i} className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`text-${s.variant === "warn" ? "accent" : "primary"}`}>{s.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground font-mono">{s.label}</p>
                <p className="text-lg font-semibold text-foreground">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Joint Angles Chart */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-mono text-foreground">Joint Angles (°)</CardTitle>
          <Button size="sm" variant="outline" onClick={handleExport} className="gap-1.5">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={jointAngleData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} tickFormatter={(v) => `${v.toFixed(1)}s`} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(220, 18%, 10%)", border: "1px solid hsl(220, 15%, 18%)", borderRadius: 6, fontSize: 11 }} />
              {selectedJoints.map((name, i) => (
                <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.5} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Stride Length */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono text-foreground">Stride Length (m)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={strideData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} tickFormatter={(v) => `${v.toFixed(1)}s`} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(220, 18%, 10%)", border: "1px solid hsl(220, 15%, 18%)", borderRadius: 6, fontSize: 11 }} />
                <Area type="monotone" dataKey="stride" stroke="hsl(160, 70%, 45%)" fill="hsl(160, 70%, 45%)" fillOpacity={0.15} strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* CoM Speed */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono text-foreground">CoM Speed (m/s)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={comData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} tickFormatter={(v) => `${v.toFixed(1)}s`} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(215, 15%, 55%)" }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(220, 18%, 10%)", border: "1px solid hsl(220, 15%, 18%)", borderRadius: 6, fontSize: 11 }} />
                <Area type="monotone" dataKey="speed" stroke="hsl(210, 80%, 55%)" fill="hsl(210, 80%, 55%)" fillOpacity={0.15} strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Anthropometry */}
      {Object.keys(anthropometry).length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono text-foreground">Anthropometric Measurements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
              {Object.entries(anthropometry).map(([name, value]) => (
                <div key={name} className="bg-secondary rounded-md p-3">
                  <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">
                    {name.replace(/_/g, " ")}
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">
                    {(value * 100).toFixed(1)} cm
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warnings */}
      {allWarnings.length > 0 && (
        <Card className="bg-card border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Biomechanical Sanity Warnings ({allWarnings.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {allWarnings.slice(0, 50).map((w, i) => (
                <div key={i} className="text-xs font-mono text-muted-foreground flex gap-2">
                  <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">
                    {w.timestamp.toFixed(3)}s
                  </Badge>
                  <span>{w.warning}</span>
                </div>
              ))}
              {allWarnings.length > 50 && (
                <p className="text-xs text-muted-foreground">... and {allWarnings.length - 50} more</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ResultsDashboard;

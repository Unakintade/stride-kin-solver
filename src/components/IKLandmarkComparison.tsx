import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { GitCompareArrows, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { FrameResult } from "@/lib/biomechanics/types";

interface Props {
  /** Results from the current pipeline (visibility gating + homography). */
  results: FrameResult[];
  /** Results from the Monday baseline pipeline (no gating, no homography). */
  baselineResults: FrameResult[];
  fps: number;
}

const IKLandmarkComparison: React.FC<Props> = ({
  results,
  baselineResults,
  fps,
}) => {
  const [frameIdx, setFrameIdx] = useState(0);
  const [selectedJoint, setSelectedJoint] = useState<string | null>(null);

  const totalFrames = Math.max(results.length, baselineResults.length);
  const hasData = results.length > 0 && baselineResults.length > 0;

  // Joint names from current results
  const jointNames = useMemo(() => {
    if (results.length === 0) return [];
    return results[0].jointAngles.map((j) => j.name);
  }, [results]);

  const activeJoint = selectedJoint ?? jointNames[0] ?? "";

  // Per-frame joint comparison at the selected frame
  const jointComparison = useMemo(() => {
    if (!hasData) return null;
    const curr = results[frameIdx];
    const base = baselineResults[frameIdx];
    if (!curr || !base) return null;

    return curr.jointAngles.map((ja) => {
      const baseJa = base.jointAngles.find((b) => b.name === ja.name);
      const delta = baseJa ? ja.angleDeg - baseJa.angleDeg : null;
      return {
        joint: ja.name,
        currentAngle: ja.angleDeg,
        baselineAngle: baseJa?.angleDeg ?? null,
        deltaDeg: delta,
        currentVel: ja.velocityRadS,
        baselineVel: baseJa?.velocityRadS ?? null,
        confidence: ja.confidence ?? null,
      };
    });
  }, [frameIdx, results, baselineResults, hasData]);

  // Stride / CoM comparison at selected frame
  const metricComparison = useMemo(() => {
    if (!hasData) return null;
    const curr = results[frameIdx];
    const base = baselineResults[frameIdx];
    if (!curr || !base) return null;

    const comSpeed = (v: [number, number, number]) =>
      Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);

    return {
      currentStride: curr.strideLength,
      baselineStride: base.strideLength,
      strideDelta: curr.strideLength - base.strideLength,
      currentComSpeed: comSpeed(curr.comVelocity),
      baselineComSpeed: comSpeed(base.comVelocity),
      comSpeedDelta: comSpeed(curr.comVelocity) - comSpeed(base.comVelocity),
    };
  }, [frameIdx, results, baselineResults, hasData]);

  // Time-series for selected joint
  const angleTimeSeries = useMemo(() => {
    if (!hasData || !activeJoint) return [];
    return results.map((r, i) => {
      const curr = r.jointAngles.find((j) => j.name === activeJoint);
      const base = baselineResults[i]?.jointAngles.find((j) => j.name === activeJoint);
      return {
        time: r.timestamp,
        frame: i,
        current: curr?.angleDeg ?? null,
        baseline: base?.angleDeg ?? null,
      };
    });
  }, [results, baselineResults, activeJoint, hasData]);

  // Summary stats: mean absolute delta across all frames and joints
  const summaryStats = useMemo(() => {
    if (!hasData) return null;
    let totalDelta = 0;
    let count = 0;
    let maxDelta = 0;
    let maxDeltaJoint = "";
    let strideDeltaSum = 0;
    let strideCount = 0;

    for (let i = 0; i < Math.min(results.length, baselineResults.length); i++) {
      const curr = results[i];
      const base = baselineResults[i];
      for (const ja of curr.jointAngles) {
        const baseJa = base.jointAngles.find((b) => b.name === ja.name);
        if (baseJa) {
          const d = Math.abs(ja.angleDeg - baseJa.angleDeg);
          totalDelta += d;
          count++;
          if (d > maxDelta) {
            maxDelta = d;
            maxDeltaJoint = ja.name;
          }
        }
      }
      if (curr.strideLength > 0 && base.strideLength > 0) {
        strideDeltaSum += Math.abs(curr.strideLength - base.strideLength);
        strideCount++;
      }
    }

    return {
      meanAngleDelta: count > 0 ? totalDelta / count : 0,
      maxAngleDelta: maxDelta,
      maxDeltaJoint,
      meanStrideDelta: strideCount > 0 ? strideDeltaSum / strideCount : 0,
    };
  }, [results, baselineResults, hasData]);

  if (!hasData) return null;

  function DeltaIcon({ value }: { value: number | null }) {
    if (value == null) return <Minus className="w-3 h-3 text-muted-foreground" />;
    if (Math.abs(value) < 0.5) return <Minus className="w-3 h-3 text-muted-foreground" />;
    return value > 0
      ? <TrendingUp className="w-3 h-3 text-primary" />
      : <TrendingDown className="w-3 h-3 text-destructive" />;
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono text-foreground flex items-center gap-2">
          <GitCompareArrows className="w-4 h-4 text-primary" />
          Baseline vs Current Kinematics
          <Badge variant="outline" className="text-[10px] text-primary/80 border-primary/30 ml-auto">
            {totalFrames} frames
          </Badge>
        </CardTitle>
        <p className="text-[10px] font-mono text-muted-foreground mt-1">
          Monday 23 Mar (no gating / no homography) → Current (visibility gate + homography)
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary stats */}
        {summaryStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-secondary rounded-md p-3">
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Mean Δ Angle</p>
              <p className="text-sm font-semibold text-foreground mt-1">{summaryStats.meanAngleDelta.toFixed(2)}°</p>
            </div>
            <div className="bg-secondary rounded-md p-3">
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Max Δ Angle</p>
              <p className="text-sm font-semibold text-foreground mt-1">{summaryStats.maxAngleDelta.toFixed(1)}°</p>
              <p className="text-[9px] font-mono text-muted-foreground truncate">{summaryStats.maxDeltaJoint}</p>
            </div>
            <div className="bg-secondary rounded-md p-3">
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Mean Δ Stride</p>
              <p className="text-sm font-semibold text-foreground mt-1">{summaryStats.meanStrideDelta.toFixed(3)} m</p>
            </div>
            <div className="bg-secondary rounded-md p-3">
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Pipeline</p>
              <p className="text-[10px] font-mono text-primary mt-1">Vis gate + Homography</p>
            </div>
          </div>
        )}

        {/* Frame selector */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">Frame</span>
          <Slider
            value={[frameIdx]}
            onValueChange={([v]) => setFrameIdx(v)}
            max={Math.max(0, totalFrames - 1)}
            step={1}
            className="flex-1"
          />
          <span className="text-[10px] font-mono text-muted-foreground w-16 text-right">
            {frameIdx}/{Math.max(0, totalFrames - 1)}
          </span>
        </div>

        {/* Joint angle comparison table */}
        {jointComparison && jointComparison.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Joint Angles — Frame {frameIdx}
            </p>
            <div className="rounded border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50">
                    <TableHead className="text-[10px] font-mono h-8">Joint</TableHead>
                    <TableHead className="text-[10px] font-mono h-8 text-right">Baseline (°)</TableHead>
                    <TableHead className="text-[10px] font-mono h-8 text-right">Current (°)</TableHead>
                    <TableHead className="text-[10px] font-mono h-8 text-right">Δ (°)</TableHead>
                    <TableHead className="text-[10px] font-mono h-8 text-right">Conf</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jointComparison.map((row) => (
                    <TableRow
                      key={row.joint}
                      className={`cursor-pointer ${activeJoint === row.joint ? "bg-primary/10" : ""}`}
                      onClick={() => setSelectedJoint(row.joint)}
                    >
                      <TableCell className="text-[11px] font-mono py-1.5 flex items-center gap-1.5">
                        <DeltaIcon value={row.deltaDeg} />
                        {row.joint}
                      </TableCell>
                      <TableCell className="text-[11px] font-mono text-right py-1.5 text-muted-foreground">
                        {row.baselineAngle != null ? row.baselineAngle.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell className="text-[11px] font-mono text-right py-1.5 text-primary">
                        {row.currentAngle.toFixed(1)}
                      </TableCell>
                      <TableCell className={`text-[11px] font-mono text-right py-1.5 ${
                        row.deltaDeg != null && Math.abs(row.deltaDeg) > 10
                          ? "text-destructive"
                          : row.deltaDeg != null && Math.abs(row.deltaDeg) > 5
                            ? "text-amber-400"
                            : "text-muted-foreground"
                      }`}>
                        {row.deltaDeg != null ? (row.deltaDeg > 0 ? "+" : "") + row.deltaDeg.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell className="text-[11px] font-mono text-right py-1.5">
                        {row.confidence != null ? (
                          <span className={row.confidence < 0.65 ? "text-destructive" : "text-muted-foreground"}>
                            {(row.confidence * 100).toFixed(0)}%
                          </span>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Stride / CoM comparison */}
        {metricComparison && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-secondary rounded-md p-3">
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">Stride Length</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-sm font-semibold text-foreground">{metricComparison.currentStride.toFixed(3)} m</span>
                <span className={`text-[10px] font-mono ${
                  Math.abs(metricComparison.strideDelta) > 0.05 ? "text-destructive" : "text-muted-foreground"
                }`}>
                  ({metricComparison.strideDelta > 0 ? "+" : ""}{metricComparison.strideDelta.toFixed(3)} vs baseline)
                </span>
              </div>
            </div>
            <div className="bg-secondary rounded-md p-3">
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider">CoM Speed</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-sm font-semibold text-foreground">{metricComparison.currentComSpeed.toFixed(2)} m/s</span>
                <span className={`text-[10px] font-mono ${
                  Math.abs(metricComparison.comSpeedDelta) > 0.5 ? "text-destructive" : "text-muted-foreground"
                }`}>
                  ({metricComparison.comSpeedDelta > 0 ? "+" : ""}{metricComparison.comSpeedDelta.toFixed(2)} vs baseline)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Angle comparison time-series chart */}
        {angleTimeSeries.length > 0 && activeJoint && (
          <div className="space-y-2">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {activeJoint} — Baseline vs Current
            </p>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={angleTimeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={(v: number) => v.toFixed(2)}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                    label={{ value: "deg", angle: -90, position: "insideLeft", fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 10,
                      fontFamily: "monospace",
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                  <ReferenceLine
                    x={angleTimeSeries[frameIdx]?.time}
                    stroke="hsl(var(--primary))"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                  />
                  <Line
                    type="monotone"
                    dataKey="baseline"
                    stroke="hsl(var(--muted-foreground))"
                    dot={false}
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    name="Baseline (Mon)"
                  />
                  <Line
                    type="monotone"
                    dataKey="current"
                    stroke="hsl(var(--primary))"
                    dot={false}
                    strokeWidth={1.5}
                    name="Current"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default IKLandmarkComparison;

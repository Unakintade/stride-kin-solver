import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LineChart, BarChart as BarIcon, TrendingUp } from "lucide-react";
import {
  LineChart as ReLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
  ComposedChart,
} from "recharts";
import { twoMassStanceLabel, type MuJoCoSolveResponse, type TwoMassStance } from "@/lib/biomechanics/mujocoApi";

interface Props {
  mujocoData: MuJoCoSolveResponse;
  fps?: number;
}

const CHART_COLORS = [
  "hsl(200, 80%, 60%)",
  "hsl(140, 70%, 50%)",
  "hsl(0, 70%, 55%)",
  "hsl(45, 90%, 55%)",
  "hsl(280, 60%, 60%)",
  "hsl(30, 80%, 55%)",
  "hsl(170, 60%, 50%)",
  "hsl(320, 60%, 55%)",
];

type ChartTab = "angles" | "torques" | "grf";

function stanceStep(s: TwoMassStance | undefined): number {
  switch (s) {
    case "l":
      return 1;
    case "r":
      return 2;
    case "double":
      return 3;
    default:
      return 0;
  }
}

const STANCE_TICKS = [0, 1, 2, 3];
const STANCE_TICK_LABELS = ["flight", "L", "R", "2×"];

const MuJoCoCharts: React.FC<Props> = ({ mujocoData, fps = 30 }) => {
  const [activeTab, setActiveTab] = useState<ChartTab>("angles");
  const frames = mujocoData.frames ?? [];

  /** Prefer frame timestamps (irregular capture); fall back to uniform i/fps */
  const chartTimes = useMemo(() => {
    if (frames.length === 0) return [];
    const ts = frames.map((f) => f.timestamp);
    const allFinite = ts.every((t) => Number.isFinite(t));
    const spread = Math.max(...ts) - Math.min(...ts);
    if (allFinite && (spread > 1e-6 || frames.length === 1)) return ts;
    return frames.map((_, i) => i / fps);
  }, [frames, fps]);

  const jointNames = useMemo(() => {
    if (frames.length === 0) return [];
    const names = new Set<string>();
    for (const f of frames) {
      if (f.joints) Object.keys(f.joints).forEach((k) => names.add(k));
    }
    return Array.from(names);
  }, [frames]);

  const angleData = useMemo(() =>
    frames.map((f, i) => {
      const row: Record<string, number> = { time: +chartTimes[i].toFixed(4) };
      jointNames.forEach((jn) => {
        row[jn] = f.joints?.[jn]?.angle_deg ?? 0;
      });
      return row;
    }), [frames, jointNames, chartTimes]);

  const torqueData = useMemo(() =>
    frames.map((f, i) => {
      const row: Record<string, number> = { time: +chartTimes[i].toFixed(4) };
      jointNames.forEach((jn) => {
        row[jn] = f.joints?.[jn]?.torque_nm ?? 0;
      });
      return row;
    }), [frames, jointNames, chartTimes]);

  const hasTwoMassStance = useMemo(
    () => frames.some((f) => f.two_mass_stance != null),
    [frames],
  );

  const grfData = useMemo(
    () =>
      frames.map((f, i) => {
        const gl = f.grf_left ?? [0, 0, 0];
        const gr = f.grf_right ?? [0, 0, 0];
        return {
          time: +chartTimes[i].toFixed(4),
          left: +Math.sqrt(gl[0] ** 2 + gl[1] ** 2 + gl[2] ** 2).toFixed(1),
          right: +Math.sqrt(gr[0] ** 2 + gr[1] ** 2 + gr[2] ** 2).toFixed(1),
          left_vertical: Math.abs(gl[1]),
          right_vertical: Math.abs(gr[1]),
          two_mass_stance_label: twoMassStanceLabel(f.two_mass_stance),
          stance_step: stanceStep(f.two_mass_stance),
        };
      }),
    [frames, chartTimes],
  );

  if (frames.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono text-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Kinetics time-series
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs font-mono text-muted-foreground">
            No frame data available. Raw response keys: {Object.keys(mujocoData._raw ?? {}).join(", ") || "none"}
          </p>
          <pre className="mt-2 bg-secondary rounded p-2 text-[10px] font-mono text-foreground overflow-auto max-h-32 whitespace-pre-wrap break-all">
            {JSON.stringify(mujocoData._raw ?? mujocoData, null, 2).slice(0, 1000)}
          </pre>
        </CardContent>
      </Card>
    );
  }

  const tabs: { key: ChartTab; label: string; icon: React.ReactNode }[] = [
    { key: "angles", label: "Joint Angles", icon: <TrendingUp className="w-3 h-3" /> },
    { key: "torques", label: "Torques", icon: <LineChart className="w-3 h-3" /> },
    { key: "grf", label: "Ground Reaction Forces", icon: <BarIcon className="w-3 h-3" /> },
  ];

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono text-foreground flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Kinetics time-series
          <Badge variant="outline" className="text-[10px] text-primary/80 border-primary/30 ml-auto">
            {frames.length} frames
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tab buttons */}
        <div className="flex gap-1.5">
          {tabs.map((t) => (
            <Button
              key={t.key}
              size="sm"
              variant={activeTab === t.key ? "default" : "outline"}
              onClick={() => setActiveTab(t.key)}
              className="font-mono text-xs h-7 gap-1.5"
            >
              {t.icon}
              {t.label}
            </Button>
          ))}
        </div>

        {/* Joint Angles Chart */}
        {activeTab === "angles" && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono text-muted-foreground">
              Joint angles over time (degrees). 0° reference line marks neutral position.
            </p>
            <div className="w-full h-72 bg-secondary/30 rounded-lg p-2">
              <ResponsiveContainer width="100%" height="100%">
                <ReLineChart data={angleData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                    label={{ value: "Time (s)", position: "insideBottom", offset: -2, style: { fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" } }}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                    label={{ value: "Angle (°)", angle: -90, position: "insideLeft", style: { fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" } }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 10,
                      fontFamily: "monospace",
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" opacity={0.5} />
                  {jointNames.map((jn, i) => (
                    <Line
                      key={jn}
                      type="monotone"
                      dataKey={jn}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={1.5}
                      dot={false}
                      name={jn}
                    />
                  ))}
                </ReLineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Torques Chart */}
        {activeTab === "torques" && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono text-muted-foreground">
              Joint torques over time (Newton-metres). Positive = extension, negative = flexion.
            </p>
            <div className="w-full h-72 bg-secondary/30 rounded-lg p-2">
              <ResponsiveContainer width="100%" height="100%">
                <ReLineChart data={torqueData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                    label={{ value: "Time (s)", position: "insideBottom", offset: -2, style: { fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" } }}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                    label={{ value: "Torque (Nm)", angle: -90, position: "insideLeft", style: { fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" } }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 10,
                      fontFamily: "monospace",
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" opacity={0.5} />
                  {jointNames.map((jn, i) => (
                    <Line
                      key={jn}
                      type="monotone"
                      dataKey={jn}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={1.5}
                      dot={false}
                      name={jn}
                    />
                  ))}
                </ReLineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* GRF Chart */}
        {activeTab === "grf" && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono text-muted-foreground">
              Ground reaction force magnitudes (N) for left and right foot, with vertical component shaded.
              {hasTwoMassStance && (
                <span className="block mt-1 text-primary/90">
                  two_mass_stance: stepped trace (right axis) — flight, left, right, double support.
                </span>
              )}
            </p>
            <div className="w-full h-72 bg-secondary/30 rounded-lg p-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={grfData} margin={{ top: 5, right: hasTwoMassStance ? 36 : 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                    label={{ value: "Time (s)", position: "insideBottom", offset: -2, style: { fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" } }}
                  />
                  <YAxis
                    yAxisId="force"
                    tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                    label={{ value: "Force (N)", angle: -90, position: "insideLeft", style: { fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" } }}
                  />
                  {hasTwoMassStance && (
                    <YAxis
                      yAxisId="stance"
                      orientation="right"
                      domain={[-0.25, 3.25]}
                      ticks={STANCE_TICKS}
                      tickFormatter={(v) => STANCE_TICK_LABELS[v] ?? v}
                      tick={{ fontSize: 8, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                      label={{
                        value: "stance",
                        angle: 90,
                        position: "insideRight",
                        style: { fontSize: 9, fontFamily: "monospace", fill: "hsl(280, 60%, 55%)" },
                      }}
                    />
                  )}
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 10,
                      fontFamily: "monospace",
                    }}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                    formatter={(value: unknown, name: string) => {
                      if (name === "two_mass_stance" && typeof value === "number") {
                        const idx = Math.round(value);
                        return [STANCE_TICK_LABELS[idx] ?? String(value), "two_mass_stance"];
                      }
                      if (typeof value === "number") return [value.toFixed(1), name];
                      return [String(value ?? ""), name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                  <ReferenceLine yAxisId="force" y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" opacity={0.5} />
                  <Area
                    yAxisId="force"
                    type="monotone"
                    dataKey="left_vertical"
                    stroke="none"
                    fill="hsl(140, 70%, 50%)"
                    fillOpacity={0.15}
                    name="Left Fy"
                  />
                  <Area
                    yAxisId="force"
                    type="monotone"
                    dataKey="right_vertical"
                    stroke="none"
                    fill="hsl(0, 70%, 55%)"
                    fillOpacity={0.15}
                    name="Right Fy"
                  />
                  <Line
                    yAxisId="force"
                    type="monotone"
                    dataKey="left"
                    stroke="hsl(140, 70%, 50%)"
                    strokeWidth={2}
                    dot={false}
                    name="Left Total"
                  />
                  <Line
                    yAxisId="force"
                    type="monotone"
                    dataKey="right"
                    stroke="hsl(0, 70%, 55%)"
                    strokeWidth={2}
                    dot={false}
                    name="Right Total"
                  />
                  {hasTwoMassStance && (
                    <Line
                      yAxisId="stance"
                      type="stepAfter"
                      dataKey="stance_step"
                      stroke="hsl(280, 60%, 55%)"
                      strokeWidth={1.5}
                      dot={false}
                      name="two_mass_stance"
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MuJoCoCharts;

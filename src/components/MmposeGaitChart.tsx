import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Footprints } from "lucide-react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  type MuJoCoSolveResponse,
  type TwoMassStance,
} from "@/lib/biomechanics/mujocoApi";

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

interface Props {
  mujocoData: MuJoCoSolveResponse;
  fps?: number;
}

/**
 * MMPose COCO-17 image-space contact hints vs optional 3D two_mass_stance (same time base).
 */
const MmposeGaitChart: React.FC<Props> = ({ mujocoData, fps = 30 }) => {
  const gait = mujocoData.mmposeGait2d;
  const frames = mujocoData.frames ?? [];

  const chartTimes = useMemo(() => {
    if (frames.length === 0) return [];
    const ts = frames.map((f) => f.timestamp);
    const allFinite = ts.every((t) => Number.isFinite(t));
    const spread = Math.max(...ts) - Math.min(...ts);
    if (allFinite && (spread > 1e-6 || frames.length === 1)) return ts;
    return frames.map((_, i) => i / fps);
  }, [frames, fps]);

  const data = useMemo(() => {
    if (!gait) return [];
    const n = Math.min(
      gait.contact_hint_l.length,
      gait.contact_hint_r.length,
      chartTimes.length,
      frames.length,
    );
    const hasStance = frames.some((f) => f.two_mass_stance != null);
    return Array.from({ length: n }, (_, i) => ({
      time: +chartTimes[i].toFixed(4),
      contactL: gait.contact_hint_l[i],
      contactR: gait.contact_hint_r[i],
      floorY: gait.floor_y_norm[i],
      ankleL: gait.ankle_l_y_norm[i],
      ankleR: gait.ankle_r_y_norm[i],
      stance_step: hasStance ? stanceStep(frames[i]?.two_mass_stance) : undefined,
    }));
  }, [gait, chartTimes, frames]);

  const skipped = mujocoData.backendMetadata?.mmpose_gait_2d_skipped;
  const err = mujocoData.backendMetadata?.mmpose_gait_2d_error;

  if (!gait) {
    if (typeof skipped !== "string" && typeof err !== "string") return null;
    return (
      <Card className="bg-card border-border mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-mono text-foreground flex items-center gap-2">
            <Footprints className="w-4 h-4 text-primary" />
            MMPose 2D ground / contact
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[10px] font-mono">
          {typeof skipped === "string" && (
            <p className="text-amber-600/90 leading-relaxed">{skipped}</p>
          )}
          {typeof err === "string" && <p className="text-destructive leading-relaxed">{err}</p>}
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) return null;

  const hasStanceOverlay = data.some((d) => d.stance_step !== undefined);

  return (
    <Card className="bg-card border-border mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono text-foreground flex items-center gap-2 flex-wrap">
          <Footprints className="w-4 h-4 text-primary" />
          MMPose 2D ground / contact
          <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
            image y ↓ normalized
          </Badge>
        </CardTitle>
        {gait.method && (
          <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">{gait.method}</p>
        )}
        {typeof skipped === "string" && (
          <p className="text-[10px] font-mono text-amber-600/90">{skipped}</p>
        )}
        {typeof err === "string" && (
          <p className="text-[10px] font-mono text-destructive">{err}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
          Soft contact proxies (0–1) from ankle height vs a rolling ground band in the video frame.
          Compare with <span className="text-primary/90">two_mass_stance</span> (3D landmarks) when overlaid.
        </p>
        <div className="w-full h-72 bg-secondary/30 rounded-lg p-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 5, right: hasStanceOverlay ? 36 : 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                label={{
                  value: "Time (s)",
                  position: "insideBottom",
                  offset: -2,
                  style: { fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" },
                }}
              />
              <YAxis
                yAxisId="contact"
                domain={[0, 1.05]}
                tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                label={{
                  value: "contact / y_norm",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" },
                }}
              />
              {hasStanceOverlay && (
                <YAxis
                  yAxisId="stance"
                  orientation="right"
                  domain={[-0.25, 3.25]}
                  ticks={STANCE_TICKS}
                  tickFormatter={(v) => STANCE_TICK_LABELS[v] ?? String(v)}
                  tick={{ fontSize: 8, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
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
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
              <Line
                yAxisId="contact"
                type="monotone"
                dataKey="contactL"
                stroke="hsl(200, 80%, 55%)"
                strokeWidth={1.8}
                dot={false}
                name="contact L"
              />
              <Line
                yAxisId="contact"
                type="monotone"
                dataKey="contactR"
                stroke="hsl(30, 85%, 52%)"
                strokeWidth={1.8}
                dot={false}
                name="contact R"
              />
              <Line
                yAxisId="contact"
                type="monotone"
                dataKey="floorY"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={1}
                strokeDasharray="4 4"
                dot={false}
                name="floor y_norm"
              />
              <Line
                yAxisId="contact"
                type="monotone"
                dataKey="ankleL"
                stroke="hsl(200, 50%, 45%)"
                strokeWidth={1}
                dot={false}
                name="ankle L y_norm"
                opacity={0.65}
              />
              <Line
                yAxisId="contact"
                type="monotone"
                dataKey="ankleR"
                stroke="hsl(30, 60%, 45%)"
                strokeWidth={1}
                dot={false}
                name="ankle R y_norm"
                opacity={0.65}
              />
              {hasStanceOverlay && (
                <Line
                  yAxisId="stance"
                  type="stepAfter"
                  dataKey="stance_step"
                  stroke="hsl(280, 60%, 55%)"
                  strokeWidth={1.2}
                  dot={false}
                  name="two_mass_stance"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};

export default MmposeGaitChart;

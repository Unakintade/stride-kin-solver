import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { GitCompareArrows, Eye, EyeOff } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { FrameLandmarks, FrameResult } from "@/lib/biomechanics/types";
import type { MuJoCoSolveResponse, MuJoCoFrameResult, MuJoCoJointResult } from "@/lib/biomechanics/mujocoApi";
import { MOCAP_TARGET_LANDMARKS, LANDMARK_NAMES } from "@/lib/biomechanics/constants";

/**
 * Map kinematics joint names (e.g. "Left Knee Extension") to MuJoCo joint
 * keys (e.g. "knee", "l_knee", "left_knee") with fuzzy matching.
 */
function findIKJoint(
  kinName: string,
  ikJoints: Record<string, MuJoCoJointResult>,
): MuJoCoJointResult | null {
  // Direct match
  if (kinName in ikJoints) return ikJoints[kinName];

  const lower = kinName.toLowerCase();

  // Build candidate tokens from the kinematics name
  // e.g. "Left Knee Extension" → ["left", "knee", "extension"]
  const tokens = lower.split(/[\s_]+/);

  // Try to find the best matching IK joint key
  const ikKeys = Object.keys(ikJoints);

  // Strategy 1: exact key match after normalising
  for (const key of ikKeys) {
    if (key.toLowerCase() === lower) return ikJoints[key];
  }

  // Strategy 2: IK key is a substring of the kinematics name or vice-versa
  for (const key of ikKeys) {
    const kl = key.toLowerCase();
    if (lower.includes(kl) || kl.includes(lower.replace(/\s+/g, "_"))) {
      return ikJoints[key];
    }
  }

  // Strategy 3: match on the anatomical part (knee, hip, ankle, elbow, shoulder)
  const anatomical = tokens.find((t) =>
    ["knee", "hip", "ankle", "elbow", "shoulder", "wrist"].includes(t),
  );
  const side = tokens.find((t) => ["left", "right", "l", "r"].includes(t));

  if (anatomical) {
    for (const key of ikKeys) {
      const kl = key.toLowerCase();
      const keyHasPart = kl.includes(anatomical);
      if (!keyHasPart) continue;

      // If we know the side, prefer matching side; otherwise take first match
      if (side) {
        const sideChar = side[0]; // 'l' or 'r'
        if (kl.startsWith(sideChar) || kl.includes(side) || kl.includes(`${sideChar}_`)) {
          return ikJoints[key];
        }
      } else {
        return ikJoints[key];
      }
    }
    // Fallback: match anatomical part without side constraint
    for (const key of ikKeys) {
      if (key.toLowerCase().includes(anatomical)) return ikJoints[key];
    }
  }

  return null;
}

interface Props {
  filteredLandmarks: FrameLandmarks[];
  results: FrameResult[];
  mujocoData: MuJoCoSolveResponse | null;
  fps: number;
}

/** Euclidean distance in 3D (metres) */
function dist3(a: number[], b: number[]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

const IKLandmarkComparison: React.FC<Props> = ({
  filteredLandmarks,
  results,
  mujocoData,
  fps,
}) => {
  const [frameIdx, setFrameIdx] = useState(0);
  const [showResidualChart, setShowResidualChart] = useState(true);

  const mujocoFrames = mujocoData?.frames ?? [];
  const totalFrames = Math.max(filteredLandmarks.length, mujocoFrames.length);
  const hasIK = mujocoFrames.length > 0;

  // Per-frame, per-joint comparison between mocap targets and IK kinematics angles
  const jointComparison = useMemo(() => {
    if (!hasIK || results.length === 0) return null;

    const frame = frameIdx;
    const kinFrame = results[frame];
    const ikFrame = mujocoFrames[frame];
    if (!kinFrame || !ikFrame) return null;

    const rows: {
      joint: string;
      mocapAngleDeg: number | null;
      ikAngleDeg: number | null;
      deltaDeg: number | null;
      mocapVelRadS: number | null;
      ikVelRadS: number | null;
      confidence: number | null;
    }[] = [];

    // Match kinematic joint names to MuJoCo joint names (fuzzy)
    const matchedIkKeys = new Set<string>();
    for (const ja of kinFrame.jointAngles) {
      const ikJoint = ikFrame.joints ? findIKJoint(ja.name, ikFrame.joints) : null;
      if (ikJoint) {
        // track which IK keys were matched
        const key = Object.entries(ikFrame.joints ?? {}).find(([, v]) => v === ikJoint)?.[0];
        if (key) matchedIkKeys.add(key);
      }
      rows.push({
        joint: ja.name,
        mocapAngleDeg: ja.angleDeg,
        ikAngleDeg: ikJoint?.angle_deg ?? null,
        deltaDeg: ikJoint ? Math.abs(ja.angleDeg - ikJoint.angle_deg) : null,
        mocapVelRadS: ja.velocityRadS,
        ikVelRadS: ikJoint?.velocity_rad_s ?? null,
        confidence: ja.confidence ?? null,
      });
    }

    // Add IK-only joints not present in kinematics
    if (ikFrame.joints) {
      for (const [name, j] of Object.entries(ikFrame.joints)) {
        if (!matchedIkKeys.has(name)) {
          rows.push({
            joint: name,
            mocapAngleDeg: null,
            ikAngleDeg: j.angle_deg,
            deltaDeg: null,
            mocapVelRadS: null,
            ikVelRadS: j.velocity_rad_s,
            confidence: null,
          });
        }
      }
    }

    return rows;
  }, [frameIdx, results, mujocoFrames, hasIK]);

  // Per-landmark residual (distance between filtered landmark world pos and IK-solved)
  const landmarkResiduals = useMemo(() => {
    if (!hasIK) return [];

    const ikFrame = mujocoFrames[frameIdx];
    const lm = filteredLandmarks[frameIdx];
    if (!ikFrame || !lm) return [];

    return Object.entries(MOCAP_TARGET_LANDMARKS).map(([name, idx]) => {
      const mocapPos = lm.worldPositions[idx];
      const vis = lm.visibility[idx];
      return {
        name,
        idx,
        visibility: vis,
        mocapPos,
        residualM: ikFrame.residual_error, // per-frame global residual
      };
    });
  }, [frameIdx, filteredLandmarks, mujocoFrames, hasIK]);

  // Time-series residual data for chart
  const residualTimeSeries = useMemo(() => {
    if (!hasIK) return [];
    return mujocoFrames.map((f, i) => ({
      time: f.timestamp || i / fps,
      residualCm: (f.residual_error ?? 0) * 100,
      frame: i,
    }));
  }, [mujocoFrames, fps, hasIK]);

  // Joint angle comparison time-series (pick the largest joint set)
  const angleTimeSeries = useMemo(() => {
    if (!hasIK || results.length === 0) return [];

    // Find all joint names that exist in both
    const sampleIk = mujocoFrames[0]?.joints ?? {};
    const sampleKin = results[0]?.jointAngles ?? [];
    const sharedJoints = sampleKin
      .map((j) => j.name)
      .filter((n) => n in sampleIk);

    if (sharedJoints.length === 0) return [];

    // Pick first shared joint for the chart
    const jointName = sharedJoints[0];

    return results.map((r, i) => {
      const ikF = mujocoFrames[i];
      const kinJ = r.jointAngles.find((j) => j.name === jointName);
      return {
        time: r.timestamp,
        frame: i,
        mocap: kinJ?.angleDeg ?? null,
        ik: ikF?.joints?.[jointName]?.angle_deg ?? null,
      };
    }).filter((d) => d.mocap !== null || d.ik !== null);
  }, [results, mujocoFrames, hasIK]);

  const sharedJointName = useMemo(() => {
    if (!hasIK || results.length === 0) return "";
    const sampleIk = mujocoFrames[0]?.joints ?? {};
    const sampleKin = results[0]?.jointAngles ?? [];
    return sampleKin.map((j) => j.name).find((n) => n in sampleIk) ?? "";
  }, [results, mujocoFrames, hasIK]);

  if (!hasIK && results.length === 0) return null;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono text-foreground flex items-center gap-2">
          <GitCompareArrows className="w-4 h-4 text-primary" />
          IK vs Mocap Landmark Comparison
          <Badge variant="outline" className="text-[10px] text-primary/80 border-primary/30 ml-auto">
            {totalFrames} frames
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
                    <TableHead className="text-[10px] font-mono h-8 text-right">Mocap (°)</TableHead>
                    <TableHead className="text-[10px] font-mono h-8 text-right">IK (°)</TableHead>
                    <TableHead className="text-[10px] font-mono h-8 text-right">Δ (°)</TableHead>
                    <TableHead className="text-[10px] font-mono h-8 text-right">Conf</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jointComparison.map((row) => (
                    <TableRow key={row.joint}>
                      <TableCell className="text-[11px] font-mono py-1.5">
                        {row.joint.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell className="text-[11px] font-mono text-right py-1.5">
                        {row.mocapAngleDeg != null ? row.mocapAngleDeg.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell className="text-[11px] font-mono text-right py-1.5 text-primary">
                        {row.ikAngleDeg != null ? row.ikAngleDeg.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell className={`text-[11px] font-mono text-right py-1.5 ${
                        row.deltaDeg != null && row.deltaDeg > 10
                          ? "text-destructive"
                          : row.deltaDeg != null && row.deltaDeg > 5
                            ? "text-amber-400"
                            : "text-muted-foreground"
                      }`}>
                        {row.deltaDeg != null ? row.deltaDeg.toFixed(1) : "—"}
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

        {/* Landmark residuals at current frame */}
        {landmarkResiduals.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Mocap Target Visibility — Frame {frameIdx}
            </p>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {landmarkResiduals.map((lr) => (
                <div
                  key={lr.name}
                  className={`bg-secondary rounded p-2 border ${
                    lr.visibility < 0.65
                      ? "border-destructive/40"
                      : "border-transparent"
                  }`}
                >
                  <p className="text-[9px] font-mono text-muted-foreground truncate">
                    {lr.name.replace(/_/g, " ")}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {lr.visibility >= 0.65 ? (
                      <Eye className="w-3 h-3 text-primary/60" />
                    ) : (
                      <EyeOff className="w-3 h-3 text-destructive/60" />
                    )}
                    <span className={`text-xs font-mono font-semibold ${
                      lr.visibility < 0.65 ? "text-destructive" : "text-foreground"
                    }`}>
                      {(lr.visibility * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Residual over time chart */}
        {residualTimeSeries.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                IK Residual Over Time
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowResidualChart(!showResidualChart)}
                className="h-6 text-[10px] font-mono text-muted-foreground"
              >
                {showResidualChart ? "Hide" : "Show"}
              </Button>
            </div>
            {showResidualChart && (
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={residualTimeSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                      tickFormatter={(v: number) => v.toFixed(2)}
                      label={{ value: "Time (s)", position: "insideBottom", offset: -2, fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
                      label={{ value: "cm", angle: -90, position: "insideLeft", fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 6,
                        fontSize: 10,
                        fontFamily: "monospace",
                      }}
                      formatter={(v: number) => [`${v.toFixed(2)} cm`, "Residual"]}
                    />
                    <ReferenceLine
                      x={residualTimeSeries[frameIdx]?.time}
                      stroke="hsl(var(--primary))"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                    />
                    <Line
                      type="monotone"
                      dataKey="residualCm"
                      stroke="hsl(var(--primary))"
                      dot={false}
                      strokeWidth={1.5}
                      name="Residual"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Angle comparison chart (first shared joint) */}
        {angleTimeSeries.length > 0 && sharedJointName && (
          <div className="space-y-2">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              {sharedJointName.replace(/_/g, " ")} — Mocap vs IK
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
                    dataKey="mocap"
                    stroke="hsl(var(--accent))"
                    dot={false}
                    strokeWidth={1.5}
                    name="Mocap"
                  />
                  <Line
                    type="monotone"
                    dataKey="ik"
                    stroke="hsl(var(--primary))"
                    dot={false}
                    strokeWidth={1.5}
                    name="IK"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {!hasIK && (
          <p className="text-[10px] font-mono text-muted-foreground">
            Run the MuJoCo IK solver above to see IK vs Mocap comparison.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default IKLandmarkComparison;

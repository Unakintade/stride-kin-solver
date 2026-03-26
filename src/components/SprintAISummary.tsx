import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { MuJoCoSolveResponse } from "@/lib/biomechanics/mujocoApi";
import type { FrameResult } from "@/lib/biomechanics/types";

interface Props {
  mujocoData: MuJoCoSolveResponse | null;
  results: FrameResult[];
  fps: number;
  anthropometry?: Record<string, number>;
  weightKg?: number;
  heightCm?: number;
}

function buildAnalysisPayload(props: Props): string {
  const { mujocoData, results, fps, anthropometry, weightKg, heightCm } = props;
  const sections: string[] = [];

  sections.push(`## Capture Info\n- FPS: ${fps}\n- Weight: ${weightKg ?? "unknown"} kg\n- Height: ${heightCm ?? "unknown"} cm`);

  if (anthropometry && Object.keys(anthropometry).length > 0) {
    sections.push(`## Anthropometry\n${Object.entries(anthropometry).map(([k, v]) => `- ${k}: ${v.toFixed(3)} m`).join("\n")}`);
  }

  // Kinematics summary from local pipeline
  if (results.length > 0) {
    const jointNames = [...new Set(results.flatMap((r) => r.jointAngles.map((j) => j.name)))];
    const jointStats = jointNames.map((name) => {
      const angles = results.map((r) => r.jointAngles.find((j) => j.name === name)?.angleDeg ?? 0);
      const velocities = results.map((r) => r.jointAngles.find((j) => j.name === name)?.velocityRadS ?? 0);
      return `- ${name}: angle range [${Math.min(...angles).toFixed(1)}°, ${Math.max(...angles).toFixed(1)}°], peak velocity ${Math.max(...velocities.map(Math.abs)).toFixed(2)} rad/s`;
    });
    sections.push(`## Local Kinematics (${results.length} frames)\n${jointStats.join("\n")}`);

    const strides = results.map((r) => r.strideLength).filter((s) => s > 0);
    if (strides.length > 0) {
      sections.push(`## Stride Length\n- Mean: ${(strides.reduce((a, b) => a + b, 0) / strides.length).toFixed(3)} m\n- Range: [${Math.min(...strides).toFixed(3)}, ${Math.max(...strides).toFixed(3)}] m`);
    }

    const comSpeeds = results.map((r) => Math.sqrt(r.comVelocity.reduce((s, v) => s + v * v, 0)));
    sections.push(`## CoM Speed\n- Peak: ${Math.max(...comSpeeds).toFixed(3)} m/s\n- Mean: ${(comSpeeds.reduce((a, b) => a + b, 0) / comSpeeds.length).toFixed(3)} m/s`);
  }

  // MuJoCo data
  if (mujocoData && mujocoData.frames.length > 0) {
    const frames = mujocoData.frames;
    const jointNames = [...new Set(frames.flatMap((f) => Object.keys(f.joints ?? {})))];

    const mujocoStats = jointNames.map((name) => {
      const angles = frames.map((f) => f.joints?.[name]?.angle_deg ?? 0);
      const torques = frames.map((f) => f.joints?.[name]?.torque_nm ?? 0);
      return `- ${name}: angle [${Math.min(...angles).toFixed(1)}°, ${Math.max(...angles).toFixed(1)}°], peak torque ${Math.max(...torques.map(Math.abs)).toFixed(1)} Nm`;
    });
    sections.push(`## Backend kinetics (${frames.length} frames)\n${mujocoStats.join("\n")}`);

    // GRF summary
    const grfMags = frames.map((f) => {
      const gl = f.grf_left ?? [0, 0, 0];
      const gr = f.grf_right ?? [0, 0, 0];
      return {
        left: Math.sqrt(gl[0] ** 2 + gl[1] ** 2 + gl[2] ** 2),
        right: Math.sqrt(gr[0] ** 2 + gr[1] ** 2 + gr[2] ** 2),
      };
    });
    sections.push(`## Ground Reaction Forces\n- Peak Left: ${Math.max(...grfMags.map((g) => g.left)).toFixed(1)} N\n- Peak Right: ${Math.max(...grfMags.map((g) => g.right)).toFixed(1)} N`);

    if (mujocoData.summary) {
      sections.push(`## Solve Summary\n- Solve time: ${mujocoData.summary.solve_time_s.toFixed(2)}s\n- Mean residual: ${mujocoData.summary.mean_residual_m.toFixed(4)} m\n- Max residual: ${mujocoData.summary.max_residual_m.toFixed(4)} m`);
    }
  }

  return sections.join("\n\n");
}

const SprintAISummary: React.FC<Props> = (props) => {
  const [summary, setSummary] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSummary("");

    const analysisData = buildAnalysisPayload(props);

    try {
      const response = await fetch(
        `${(supabase as any).supabaseUrl}/functions/v1/sprint-analysis`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysisData }),
        }
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error((errBody as any).error || `Error ${response.status}`);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              accumulated += content;
              setSummary(accumulated);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (e: any) {
      console.error("Sprint analysis error:", e);
      setError(e.message || "Failed to generate analysis");
    } finally {
      setIsLoading(false);
    }
  }, [props]);

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono text-foreground flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" />
          AI Sprint Coach Analysis
          {summary && (
            <Badge variant="outline" className="text-[10px] text-primary/80 border-primary/30 ml-auto">
              AI-powered
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!summary && !isLoading && !error && (
          <div className="text-center py-6 space-y-3">
            <p className="text-xs font-mono text-muted-foreground">
              Get an AI-powered analysis of sprint biomechanics, identifying limiters to world-class performance and actionable corrections.
            </p>
            <Button onClick={runAnalysis} className="gap-2 font-mono text-xs">
              <Brain className="w-3.5 h-3.5" />
              Generate Sprint Analysis
            </Button>
          </div>
        )}

        {isLoading && !summary && (
          <div className="flex items-center gap-2 py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span className="text-xs font-mono text-muted-foreground">Analyzing biomechanical data...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 rounded bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
            <p className="text-xs font-mono text-destructive">{error}</p>
          </div>
        )}

        {summary && (
          <div className="prose prose-sm prose-invert max-w-none font-mono text-xs text-foreground 
            prose-headings:text-foreground prose-headings:font-mono prose-headings:text-sm
            prose-strong:text-foreground prose-li:text-foreground/90
            prose-p:text-foreground/90 prose-p:leading-relaxed">
            <ReactMarkdown>{summary}</ReactMarkdown>
          </div>
        )}

        {summary && !isLoading && (
          <div className="pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={runAnalysis}
              className="font-mono text-xs gap-1.5"
            >
              <Brain className="w-3 h-3" />
              Regenerate
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SprintAISummary;

import React from "react";
import type { PipelineStage } from "@/lib/biomechanics/types";
import { Activity, Filter, Cpu, BarChart3, CheckCircle2, Loader2, Circle } from "lucide-react";

interface Props {
  stages: PipelineStage[];
}

const STAGE_ICONS: Record<string, React.ReactNode> = {
  detection: <Activity className="w-4 h-4" />,
  filtering: <Filter className="w-4 h-4" />,
  kinematics: <Cpu className="w-4 h-4" />,
  results: <BarChart3 className="w-4 h-4" />,
};

const PipelineStatus: React.FC<Props> = ({ stages }) => {
  return (
    <div className="flex items-center gap-2">
      {stages.map((stage, i) => (
        <React.Fragment key={stage.id}>
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
              stage.status === "active"
                ? "bg-primary/15 text-primary border border-primary/30"
                : stage.status === "complete"
                ? "bg-primary/10 text-primary/70 border border-primary/20"
                : stage.status === "error"
                ? "bg-destructive/15 text-destructive border border-destructive/30"
                : "bg-secondary text-muted-foreground border border-border"
            }`}
          >
            {stage.status === "active" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : stage.status === "complete" ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              STAGE_ICONS[stage.id] || <Circle className="w-3.5 h-3.5" />
            )}
            <span>{stage.name}</span>
            {stage.status === "active" && stage.progress > 0 && (
              <span className="text-[10px] opacity-70">
                {Math.round(stage.progress * 100)}%
              </span>
            )}
          </div>
          {i < stages.length - 1 && (
            <div
              className={`w-6 h-px ${
                stage.status === "complete" ? "bg-primary/40" : "bg-border"
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default PipelineStatus;

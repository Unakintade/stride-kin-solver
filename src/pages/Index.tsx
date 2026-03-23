import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Activity, Cpu, Filter, BarChart3, ArrowRight, Zap, Eye, Download } from "lucide-react";

const PIPELINE_STEPS = [
  {
    icon: <Eye className="w-6 h-6" />,
    title: "BlazePose Detection",
    description: "33 landmarks per frame via MediaPipe's heavy model with GPU acceleration",
    tech: "MediaPipe Tasks Vision",
  },
  {
    icon: <Filter className="w-6 h-6" />,
    title: "Kalman Filtering",
    description: "Constant-acceleration model with adaptive R based on visibility scores",
    tech: "Custom CA Filter Bank",
  },
  {
    icon: <Cpu className="w-6 h-6" />,
    title: "Kinematic Analysis",
    description: "Joint angles, angular velocities, stride length, and CoM tracking",
    tech: "3D Vector Mathematics",
  },
  {
    icon: <BarChart3 className="w-6 h-6" />,
    title: "Results & Export",
    description: "Interactive charts, sanity warnings, anthropometry, and CSV export",
    tech: "Recharts + CSV Export",
  },
];

const Index: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen gradient-mesh">
      <div className="grid-bg min-h-screen">
        {/* Header */}
        <header className="border-b border-border/50 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center">
                <Activity className="w-4.5 h-4.5 text-primary" />
              </div>
              <span className="font-mono text-sm font-semibold text-foreground tracking-tight">
                SprintKinematics
              </span>
            </div>
            <Button onClick={() => navigate("/analyze")} className="gap-2 font-mono text-xs">
              Launch Analyzer <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </header>

        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 pt-24 pb-16">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-mono mb-6">
              <Zap className="w-3 h-3" />
              Browser-native biomechanics • No install required
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-foreground leading-tight tracking-tight">
              Sprint Kinematics
              <span className="block text-primary mt-1">Estimation Engine</span>
            </h1>
            <p className="text-muted-foreground text-lg mt-6 max-w-2xl leading-relaxed">
              Estimate human kinematics from sprinting videos using MediaPipe BlazePose
              for landmark detection and physics-constrained analysis — entirely in the browser.
            </p>
            <div className="flex gap-3 mt-8">
              <Button size="lg" onClick={() => navigate("/analyze")} className="gap-2 font-mono">
                <Activity className="w-4 h-4" /> Analyze Video
              </Button>
              <Button size="lg" variant="outline" className="gap-2 font-mono" onClick={() => {
                document.getElementById("pipeline")?.scrollIntoView({ behavior: "smooth" });
              }}>
                View Pipeline
              </Button>
            </div>
          </div>
        </section>

        {/* Pipeline */}
        <section id="pipeline" className="max-w-6xl mx-auto px-6 pb-24">
          <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-8">
            Processing Pipeline
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {PIPELINE_STEPS.map((step, i) => (
              <div
                key={i}
                className="bg-card/80 border border-border rounded-lg p-6 hover:border-primary/30 transition-colors group"
              >
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="text-primary/70 group-hover:text-primary transition-colors">
                    {step.icon}
                  </div>
                </div>
                <h3 className="text-foreground font-semibold text-sm mb-2">{step.title}</h3>
                <p className="text-muted-foreground text-xs leading-relaxed mb-3">
                  {step.description}
                </p>
                <span className="text-[10px] font-mono text-primary/60 uppercase tracking-wider">
                  {step.tech}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-border/50 bg-card/30">
          <div className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: <Zap className="w-5 h-5" />, title: "GPU Accelerated", desc: "WebGPU-powered BlazePose runs in real-time on modern browsers" },
              { icon: <Activity className="w-5 h-5" />, title: "Sanity Checks", desc: "Warnings when joint velocities exceed physiological limits" },
              { icon: <Download className="w-5 h-5" />, title: "CSV Export", desc: "Joint angles, velocities, stride length, and CoM data" },
            ].map((f, i) => (
              <div key={i} className="flex gap-4">
                <div className="text-primary shrink-0 mt-0.5">{f.icon}</div>
                <div>
                  <h3 className="text-foreground font-medium text-sm mb-1">{f.title}</h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Index;

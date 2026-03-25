import React, { useRef, useState, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Text, Line, Html } from "@react-three/drei";
import * as THREE from "three";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Play, Pause, SkipBack, SkipForward, RotateCcw, Box,
} from "lucide-react";
import type { MuJoCoSolveResponse, MuJoCoFrameResult } from "@/lib/biomechanics/mujocoApi";
import type { FrameLandmarks } from "@/lib/biomechanics/types";
import { SKELETON_CONNECTIONS, LANDMARK_NAMES } from "@/lib/biomechanics/constants";

/* ─── Types ───────────────────────────────────────── */
interface Props {
  mujocoData: MuJoCoSolveResponse | null;
  landmarks?: FrameLandmarks[];
  fps?: number;
}

/* ─── Helpers ─────────────────────────────────────── */
const JOINT_COLOR = new THREE.Color("hsl(200, 80%, 60%)");
const BONE_COLOR = new THREE.Color("hsl(200, 40%, 50%)");
const GRF_LEFT_COLOR = new THREE.Color("hsl(140, 70%, 50%)");
const GRF_RIGHT_COLOR = new THREE.Color("hsl(0, 70%, 55%)");
const COM_COLOR = new THREE.Color("hsl(45, 90%, 55%)");
const GROUND_PLANE_Y = 0;
const GRF_SCALE = 0.001; // N → visual length

/* ─── 3D Joint Sphere ────────────────────────────── */
function JointSphere({ position, color, size = 0.015 }: {
  position: [number, number, number];
  color: THREE.Color;
  size?: number;
}) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[size, 12, 12]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
    </mesh>
  );
}

/* ─── GRF Arrow ───────────────────────────────────── */
function GRFArrow({ origin, force, color }: {
  origin: [number, number, number];
  force: [number, number, number];
  color: THREE.Color;
}) {
  const mag = Math.sqrt(force[0] ** 2 + force[1] ** 2 + force[2] ** 2);
  if (mag < 1) return null;

  const end: [number, number, number] = [
    origin[0] + force[0] * GRF_SCALE,
    origin[1] + force[1] * GRF_SCALE,
    origin[2] + force[2] * GRF_SCALE,
  ];

  return (
    <group>
      <Line
        points={[origin, end]}
        color={color}
        lineWidth={3}
      />
      <mesh position={end}>
        <coneGeometry args={[0.008, 0.025, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
      <Html position={end} center style={{ pointerEvents: "none" }}>
        <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-background/80 text-foreground border border-border whitespace-nowrap">
          {mag.toFixed(0)} N
        </span>
      </Html>
    </group>
  );
}

/* ─── CoM Marker ──────────────────────────────────── */
function CoMMarker({ position, velocity }: {
  position: [number, number, number];
  velocity: [number, number, number];
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 2;
  });

  const speed = Math.sqrt(velocity[0] ** 2 + velocity[1] ** 2 + velocity[2] ** 2);

  return (
    <group position={position}>
      <mesh ref={ref}>
        <octahedronGeometry args={[0.02, 0]} />
        <meshStandardMaterial
          color={COM_COLOR}
          emissive={COM_COLOR}
          emissiveIntensity={0.6}
          wireframe
        />
      </mesh>
      <Html center style={{ pointerEvents: "none" }}>
        <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-background/80 text-foreground border border-border whitespace-nowrap">
          CoM {speed.toFixed(2)} m/s
        </span>
      </Html>
    </group>
  );
}

/* ─── IMU Data Overlay ────────────────────────────── */
function IMUOverlay({ frame, jointName, position }: {
  frame: MuJoCoFrameResult;
  jointName: string;
  position: [number, number, number];
}) {
  const joint = frame.joints?.[jointName];
  if (!joint) return null;

  return (
    <Html position={position} center style={{ pointerEvents: "none" }}>
      <div className="text-[8px] font-mono px-1.5 py-1 rounded bg-background/90 text-foreground border border-primary/30 space-y-0.5 whitespace-nowrap">
        <div className="text-primary font-semibold">{jointName}</div>
        <div>θ {(joint.angle_deg ?? 0).toFixed(1)}°</div>
        <div>ω {(joint.velocity_rad_s ?? 0).toFixed(1)} rad/s</div>
        {(joint.torque_nm ?? 0) !== 0 && (
          <div>τ {joint.torque_nm.toFixed(1)} Nm</div>
        )}
      </div>
    </Html>
  );
}

/* ─── Skeleton Scene ──────────────────────────────── */
function SkeletonScene({ landmarks, mujocoFrame, showIMU }: {
  landmarks: FrameLandmarks | null;
  mujocoFrame: MuJoCoFrameResult | null;
  showIMU: boolean;
}) {
  const wp = landmarks?.worldPositions;
  const hasData = !!wp && wp.length >= 33;

  // Convert MediaPipe world coords to three.js (swap Y/Z for upright)
  const positions = useMemo(() => {
    if (!hasData) return [];
    return wp!.map((p) => [p[0], -p[1], -p[2]] as [number, number, number]);
  }, [wp, hasData]);

  // Find ground level (lowest Y)
  const groundY = useMemo(() => {
    if (positions.length === 0) return 0;
    return Math.min(...positions.map(p => p[1]));
  }, [positions]);

  // Shift everything so feet are on ground
  const shiftedPositions = useMemo(() => {
    if (positions.length === 0) return [];
    const offset = groundY - GROUND_PLANE_Y;
    return positions.map(p => [p[0], p[1] - offset, p[2]] as [number, number, number]);
  }, [positions, groundY]);

  // Map joint names to landmark indices for IMU overlays
  const imuJoints = useMemo(() => {
    if (!mujocoFrame?.joints) return [];
    const nameToIdx: Record<string, number> = {
      knee: 25, left_knee: 25, right_knee: 26,
      hip: 23, left_hip: 23, right_hip: 24,
      ankle: 27, left_ankle: 27, right_ankle: 28,
      shoulder: 11, left_shoulder: 11, right_shoulder: 12,
      elbow: 13, left_elbow: 13, right_elbow: 14,
    };
    return Object.keys(mujocoFrame.joints)
      .filter(name => name in nameToIdx)
      .map(name => ({ name, idx: nameToIdx[name] }));
  }, [mujocoFrame]);

  if (!hasData) return null;

  return (
    <group>
      {/* Joint spheres */}
      {shiftedPositions.map((pos, i) => {
        if (i < 11 || (landmarks.visibility?.[i] ?? 0) < 0.3) return null;
        return <JointSphere key={i} position={pos} color={JOINT_COLOR} />;
      })}

      {/* Bones */}
      {SKELETON_CONNECTIONS.map(([a, b], i) => {
        if ((landmarks.visibility?.[a] ?? 0) < 0.3 || (landmarks.visibility?.[b] ?? 0) < 0.3) return null;
        return (
          <Line
            key={`bone-${i}`}
            points={[shiftedPositions[a], shiftedPositions[b]]}
            color={BONE_COLOR}
            lineWidth={2}
          />
        );
      })}

      {/* CoM marker */}
      {mujocoFrame?.com_position && (
        <CoMMarker
          position={[
            mujocoFrame.com_position[0],
            -mujocoFrame.com_position[1],
            -mujocoFrame.com_position[2],
          ]}
          velocity={mujocoFrame.com_velocity ?? [0, 0, 0]}
        />
      )}

      {/* GRF arrows from feet */}
      {mujocoFrame?.grf_left && (
        <GRFArrow
          origin={shiftedPositions[27] ?? [0, 0, 0]}
          force={[
            mujocoFrame.grf_left[0],
            -mujocoFrame.grf_left[1],
            -mujocoFrame.grf_left[2],
          ]}
          color={GRF_LEFT_COLOR}
        />
      )}
      {mujocoFrame?.grf_right && (
        <GRFArrow
          origin={shiftedPositions[28] ?? [0, 0, 0]}
          force={[
            mujocoFrame.grf_right[0],
            -mujocoFrame.grf_right[1],
            -mujocoFrame.grf_right[2],
          ]}
          color={GRF_RIGHT_COLOR}
        />
      )}

      {/* IMU overlays */}
      {showIMU && mujocoFrame && imuJoints.map(({ name, idx }) => (
        <IMUOverlay
          key={name}
          frame={mujocoFrame}
          jointName={name}
          position={shiftedPositions[idx] ?? [0, 0, 0]}
        />
      ))}

      {/* Ground plane */}
      <Grid
        args={[2, 2]}
        cellSize={0.1}
        cellThickness={0.5}
        cellColor="hsl(200, 20%, 30%)"
        sectionSize={0.5}
        sectionThickness={1}
        sectionColor="hsl(200, 30%, 40%)"
        fadeDistance={3}
        position={[0, GROUND_PLANE_Y, 0]}
      />
    </group>
  );
}

/* ─── Main Component ──────────────────────────────── */
const Skeleton3DViewer: React.FC<Props> = ({ mujocoData, landmarks, fps = 30 }) => {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showIMU, setShowIMU] = useState(true);
  const animRef = useRef<number>(0);

  const frames = mujocoData?.frames ?? [];
  const totalFrames = Math.max(frames.length, landmarks?.length ?? 0);

  // Reset on new data
  useEffect(() => {
    setCurrentFrame(0);
    setIsPlaying(false);
  }, [mujocoData]);

  // Playback loop
  useEffect(() => {
    if (!isPlaying || totalFrames <= 1) return;
    const interval = 1000 / fps;
    let last = performance.now();

    const tick = (now: number) => {
      if (now - last >= interval) {
        last = now;
        setCurrentFrame(f => {
          const next = f + 1;
          if (next >= totalFrames) {
            setIsPlaying(false);
            return f;
          }
          return next;
        });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, totalFrames, fps]);

  const currentLandmark = landmarks?.[currentFrame] ?? null;
  const currentMujocoFrame = frames[currentFrame] ?? null;

  if (!mujocoData && (!landmarks || landmarks.length === 0)) {
    return null;
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono text-foreground flex items-center gap-2">
          <Box className="w-4 h-4 text-primary" />
          3D Biomechanical Model
          <Badge variant="outline" className="text-[10px] text-primary/80 border-primary/30 ml-auto">
            {totalFrames} frames
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 3D Canvas */}
        <div className="w-full rounded-lg overflow-hidden border border-border bg-background" style={{ height: 480 }}>
          <Canvas
            camera={{ position: [0.8, 0.6, 1.2], fov: 50 }}
            gl={{ antialias: true, alpha: false }}
            style={{ background: "hsl(220, 20%, 8%)" }}
          >
            <ambientLight intensity={0.4} />
            <directionalLight position={[2, 3, 1]} intensity={0.8} />
            <pointLight position={[-1, 2, -1]} intensity={0.3} color="hsl(200, 80%, 60%)" />

            <SkeletonScene
              landmarks={currentLandmark}
              mujocoFrame={currentMujocoFrame}
              showIMU={showIMU}
            />

            <OrbitControls
              enableDamping
              dampingFactor={0.1}
              minDistance={0.3}
              maxDistance={5}
              target={[0, 0.5, 0]}
            />
          </Canvas>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCurrentFrame(0)}>
            <SkipBack className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setCurrentFrame(Math.max(0, totalFrames - 1))}
          >
            <SkipForward className="w-3.5 h-3.5" />
          </Button>
          <Slider
            value={[currentFrame]}
            onValueChange={([v]) => { setIsPlaying(false); setCurrentFrame(v); }}
            max={Math.max(0, totalFrames - 1)}
            step={1}
            className="flex-1"
          />
          <span className="text-[10px] font-mono text-muted-foreground w-20 text-right">
            {currentFrame}/{Math.max(0, totalFrames - 1)}
          </span>
        </div>

        {/* Toggle buttons */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={showIMU ? "default" : "outline"}
            onClick={() => setShowIMU(!showIMU)}
            className="font-mono text-xs h-7"
          >
            IMU Data
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setCurrentFrame(0); setIsPlaying(false); }}
            className="font-mono text-xs h-7 gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </Button>
        </div>

        {/* Current frame stats */}
        {currentMujocoFrame && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {currentMujocoFrame.com_position && (
              <div className="bg-secondary rounded p-2">
                <p className="text-[9px] font-mono text-muted-foreground">CoM Position</p>
                <p className="text-xs font-mono text-foreground">
                  ({currentMujocoFrame.com_position.map(v => v.toFixed(3)).join(", ")})
                </p>
              </div>
            )}
            {currentMujocoFrame.grf_left && (
              <div className="bg-secondary rounded p-2">
                <p className="text-[9px] font-mono text-muted-foreground">GRF Left (N)</p>
                <p className="text-xs font-mono text-foreground">
                  {Math.sqrt(currentMujocoFrame.grf_left.reduce((s, v) => s + v * v, 0)).toFixed(1)}
                </p>
              </div>
            )}
            {currentMujocoFrame.grf_right && (
              <div className="bg-secondary rounded p-2">
                <p className="text-[9px] font-mono text-muted-foreground">GRF Right (N)</p>
                <p className="text-xs font-mono text-foreground">
                  {Math.sqrt(currentMujocoFrame.grf_right.reduce((s, v) => s + v * v, 0)).toFixed(1)}
                </p>
              </div>
            )}
            {currentMujocoFrame.residual_error != null && (
              <div className="bg-secondary rounded p-2">
                <p className="text-[9px] font-mono text-muted-foreground">Residual</p>
                <p className="text-xs font-mono text-foreground">
                  {(currentMujocoFrame.residual_error * 100).toFixed(2)} cm
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default Skeleton3DViewer;

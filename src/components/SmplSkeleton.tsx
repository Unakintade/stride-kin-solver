import React, { useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import type { MuJoCoFrameResult } from "@/lib/biomechanics/mujocoApi";

/**
 * SMPL-24 volumetric skeleton renderer.
 * Consumes `keypoints3d` (24×3 in metres) emitted by the mmpose / mmhuman3d
 * pipeline on the biomech-worker backend.
 */

export const SMPL = {
  pelvis: 0,
  l_hip: 1, r_hip: 2, spine1: 3,
  l_knee: 4, r_knee: 5, spine2: 6,
  l_ankle: 7, r_ankle: 8, spine3: 9,
  l_foot: 10, r_foot: 11,
  neck: 12, l_collar: 13, r_collar: 14, head: 15,
  l_shoulder: 16, r_shoulder: 17,
  l_elbow: 18, r_elbow: 19,
  l_wrist: 20, r_wrist: 21,
  l_hand: 22, r_hand: 23,
} as const;

type BoneSpec = [number, number, number, number]; // [a, b, rA, rB]

const SMPL_BONES: BoneSpec[] = [
  [SMPL.pelvis, SMPL.spine1, 0.085, 0.075],
  [SMPL.spine1, SMPL.spine2, 0.085, 0.090],
  [SMPL.spine2, SMPL.spine3, 0.090, 0.080],
  [SMPL.spine3, SMPL.neck, 0.060, 0.045],
  [SMPL.neck, SMPL.head, 0.040, 0.040],
  [SMPL.pelvis, SMPL.l_hip, 0.070, 0.060],
  [SMPL.pelvis, SMPL.r_hip, 0.070, 0.060],
  [SMPL.l_hip, SMPL.l_knee, 0.065, 0.045],
  [SMPL.l_knee, SMPL.l_ankle, 0.045, 0.030],
  [SMPL.l_ankle, SMPL.l_foot, 0.030, 0.025],
  [SMPL.r_hip, SMPL.r_knee, 0.065, 0.045],
  [SMPL.r_knee, SMPL.r_ankle, 0.045, 0.030],
  [SMPL.r_ankle, SMPL.r_foot, 0.030, 0.025],
  [SMPL.spine3, SMPL.l_collar, 0.045, 0.040],
  [SMPL.spine3, SMPL.r_collar, 0.045, 0.040],
  [SMPL.l_collar, SMPL.l_shoulder, 0.045, 0.045],
  [SMPL.r_collar, SMPL.r_shoulder, 0.045, 0.045],
  [SMPL.l_shoulder, SMPL.l_elbow, 0.045, 0.035],
  [SMPL.l_elbow, SMPL.l_wrist, 0.035, 0.025],
  [SMPL.l_wrist, SMPL.l_hand, 0.025, 0.022],
  [SMPL.r_shoulder, SMPL.r_elbow, 0.045, 0.035],
  [SMPL.r_elbow, SMPL.r_wrist, 0.035, 0.025],
  [SMPL.r_wrist, SMPL.r_hand, 0.025, 0.022],
];

const BONE_COLOR = new THREE.Color("hsl(200, 65%, 55%)");
const JOINT_COLOR = new THREE.Color("hsl(200, 80%, 70%)");
const HEAD_COLOR = new THREE.Color("hsl(200, 50%, 65%)");
const GRF_LEFT = new THREE.Color("hsl(140, 70%, 50%)");
const GRF_RIGHT = new THREE.Color("hsl(0, 70%, 55%)");
const COM_COLOR = new THREE.Color("hsl(45, 90%, 55%)");

function VolumetricBone({
  start, end, rA, rB, color,
}: {
  start: THREE.Vector3; end: THREE.Vector3; rA: number; rB: number; color: THREE.Color;
}) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const length = dir.length();
  if (length < 1e-5) return null;
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize(),
  );
  return (
    <group>
      <mesh position={mid} quaternion={quat} castShadow>
        <cylinderGeometry args={[rB, rA, length, 16, 1]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.18}
          metalness={0.25}
          roughness={0.5}
        />
      </mesh>
      <mesh position={start} castShadow>
        <sphereGeometry args={[rA * 1.05, 14, 14]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} />
      </mesh>
      <mesh position={end} castShadow>
        <sphereGeometry args={[rB * 1.05, 14, 14]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.18} />
      </mesh>
    </group>
  );
}

function GRFArrow({
  origin, vector, color,
}: {
  origin: THREE.Vector3; vector: [number, number, number]; color: THREE.Color;
}) {
  const v = new THREE.Vector3(vector[0], vector[1], vector[2]);
  const mag = v.length();
  if (mag < 1) return null;
  const scale = Math.min(mag / 1500, 1.4);
  const dir = v.clone().normalize();
  const end = origin.clone().add(dir.clone().multiplyScalar(scale));
  const mid = origin.clone().add(end).multiplyScalar(0.5);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return (
    <group>
      <mesh position={mid} quaternion={quat}>
        <cylinderGeometry args={[0.015, 0.015, scale, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
      <mesh position={end} quaternion={quat}>
        <coneGeometry args={[0.04, 0.1, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
      </mesh>
      <Html position={[end.x, end.y, end.z]} center style={{ pointerEvents: "none" }}>
        <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-background/80 text-foreground border border-border whitespace-nowrap">
          {mag.toFixed(0)} N
        </span>
      </Html>
    </group>
  );
}

interface Props {
  keypoints: number[][]; // [24, 3] in metres (SMPL convention, y-up)
  frame?: MuJoCoFrameResult | null;
  groundY?: number;
}

const SmplSkeletonMesh: React.FC<Props> = ({ keypoints, frame, groundY = 0 }) => {
  const points = useMemo(() => {
    const raw = keypoints
      .slice(0, 24)
      .map((p) => new THREE.Vector3(Number(p[0] ?? 0), Number(p[1] ?? 0), Number(p[2] ?? 0)));
    if (raw.length < 16) return raw;
    // Ground feet at groundY
    const lowestY = Math.min(
      raw[SMPL.l_foot]?.y ?? Infinity,
      raw[SMPL.r_foot]?.y ?? Infinity,
      raw[SMPL.l_ankle]?.y ?? Infinity,
      raw[SMPL.r_ankle]?.y ?? Infinity,
    );
    if (!isFinite(lowestY)) return raw;
    const offset = lowestY - groundY;
    return raw.map((p) => new THREE.Vector3(p.x, p.y - offset, p.z));
  }, [keypoints, groundY]);

  if (points.length < 16) return null;

  const headPos = points[SMPL.head];
  const neckPos = points[SMPL.neck];
  const headRadius =
    headPos && neckPos ? Math.max(0.085, headPos.distanceTo(neckPos) * 0.95) : 0.1;

  return (
    <group>
      {/* Bones */}
      {SMPL_BONES.map(([a, b, rA, rB], i) => {
        const start = points[a];
        const end = points[b];
        if (!start || !end) return null;
        return (
          <VolumetricBone
            key={i}
            start={start}
            end={end}
            rA={rA}
            rB={rB}
            color={BONE_COLOR}
          />
        );
      })}

      {/* Head */}
      {headPos && (
        <mesh position={headPos} castShadow>
          <sphereGeometry args={[headRadius, 22, 22]} />
          <meshStandardMaterial
            color={HEAD_COLOR}
            emissive={HEAD_COLOR}
            emissiveIntensity={0.12}
            roughness={0.55}
          />
        </mesh>
      )}

      {/* Joint nodes */}
      {points.map((p, i) => (
        <mesh key={`j-${i}`} position={p}>
          <sphereGeometry args={[0.018, 10, 10]} />
          <meshStandardMaterial color={JOINT_COLOR} emissive={JOINT_COLOR} emissiveIntensity={0.3} />
        </mesh>
      ))}

      {/* GRF arrows at ankles */}
      {frame?.grf_left && points[SMPL.l_ankle] && (
        <GRFArrow origin={points[SMPL.l_ankle]} vector={frame.grf_left} color={GRF_LEFT} />
      )}
      {frame?.grf_right && points[SMPL.r_ankle] && (
        <GRFArrow origin={points[SMPL.r_ankle]} vector={frame.grf_right} color={GRF_RIGHT} />
      )}

      {/* CoM marker */}
      {frame?.com_position && (
        <mesh
          position={[
            frame.com_position[0],
            frame.com_position[1] - (groundY === 0 ? 0 : 0),
            frame.com_position[2],
          ]}
        >
          <octahedronGeometry args={[0.025, 0]} />
          <meshStandardMaterial
            color={COM_COLOR}
            emissive={COM_COLOR}
            emissiveIntensity={0.6}
            wireframe
          />
        </mesh>
      )}
    </group>
  );
};

export default SmplSkeletonMesh;

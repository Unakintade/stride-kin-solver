import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import type { MuJoCoFrameResult } from "@/lib/biomechanics/mujocoApi";

/**
 * SMPL surface mesh renderer.
 * Consumes per-frame `vertices` (6890×3, metres, y-up) and static `faces`
 * (~13k triangles) emitted by the mmhuman3d / SMPL pipeline on the
 * biomech-worker backend.
 */

interface Props {
  vertices: number[][];
  faces: number[][];
  frame?: MuJoCoFrameResult | null;
  groundY?: number;
  /** Optional 0..1 normalized "muscle heat" (drives emissive intensity). */
  muscleHeat?: number;
}

const SKIN_COLOR = new THREE.Color("hsl(200, 50%, 60%)");
const HEAT_COLOR = new THREE.Color("hsl(15, 90%, 55%)");

const SmplMeshSurface: React.FC<Props> = ({
  vertices,
  faces,
  groundY = 0,
  muscleHeat = 0,
}) => {
  const geomRef = useRef<THREE.BufferGeometry>(null);

  // Static index buffer (faces don't change frame-to-frame).
  const indexBuffer = useMemo(() => {
    const flat = new Uint32Array(faces.length * 3);
    for (let i = 0; i < faces.length; i++) {
      flat[i * 3 + 0] = faces[i][0];
      flat[i * 3 + 1] = faces[i][1];
      flat[i * 3 + 2] = faces[i][2];
    }
    return flat;
  }, [faces]);

  // Initial position buffer (sized once; mutated each frame).
  const positionBuffer = useMemo(
    () => new Float32Array(vertices.length * 3),
    [vertices.length],
  );

  // Ground offset so feet rest on groundY.
  const yOffset = useMemo(() => {
    let lowest = Infinity;
    for (let i = 0; i < vertices.length; i++) {
      const y = Number(vertices[i]?.[1] ?? 0);
      if (y < lowest) lowest = y;
    }
    return Number.isFinite(lowest) ? lowest - groundY : 0;
  }, [vertices, groundY]);

  // Update positions whenever the vertices array changes.
  useEffect(() => {
    if (!geomRef.current) return;
    const attr = geomRef.current.getAttribute("position") as THREE.BufferAttribute | null;
    if (!attr) return;
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      attr.setXYZ(i, Number(v?.[0] ?? 0), Number(v?.[1] ?? 0) - yOffset, Number(v?.[2] ?? 0));
    }
    attr.needsUpdate = true;
    geomRef.current.computeVertexNormals();
    geomRef.current.computeBoundingSphere();
  }, [vertices, yOffset]);

  if (!vertices.length || !faces.length) return null;

  const heat = Math.max(0, Math.min(1, muscleHeat));
  const color = heat > 0.05 ? SKIN_COLOR.clone().lerp(HEAT_COLOR, heat) : SKIN_COLOR;

  return (
    <mesh castShadow receiveShadow>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute
          attach="attributes-position"
          array={positionBuffer}
          count={vertices.length}
          itemSize={3}
        />
        <bufferAttribute
          attach="index"
          array={indexBuffer}
          count={indexBuffer.length}
          itemSize={1}
        />
      </bufferGeometry>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.15 + heat * 0.5}
        roughness={0.55}
        metalness={0.15}
        side={THREE.DoubleSide}
        flatShading={false}
      />
    </mesh>
  );
};

export default SmplMeshSurface;

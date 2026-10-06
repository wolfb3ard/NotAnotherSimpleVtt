'use client';

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  DoubleSide,
  Euler,
  Group,
  MeshPhysicalMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { buildDieModel, landingRotation, visualSides } from '@/lib/dice-model';
import { diceLayout, rollPose, rollDuration, type DiceTarget } from '@/lib/dice-motion';
import type { DieVisual, Presentation } from '@/lib/dice-presentation';
import type { DiceStyle } from '@/lib/types';

function labelTexture(label: string, style: DiceStyle) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${label.length > 1 ? 128 : 166}px Arial, sans-serif`;
  ctx.lineWidth = 16;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style.outlineColor;
  ctx.fillStyle = style.numberColor;
  ctx.strokeText(label, 128, 133);
  ctx.fillText(label, 128, 133);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function Die({
  die,
  style,
  index,
  still,
  target,
  width,
  height,
}: {
  die: DieVisual;
  style: DiceStyle;
  index: number;
  still: boolean;
  target: DiceTarget;
  width: number;
  height: number;
}) {
  const shape = visualSides(die.sides);
  const model = useMemo(() => buildDieModel(shape), [shape]);
  const final = useMemo(
    () => landingRotation(model, die.masked ? 1 : die.value),
    [model, die.masked, die.value],
  );
  const textures = useMemo(
    () =>
      model.faces.map((face) =>
        labelTexture(
          die.masked ? '?' : String(shape === 10 && face.value === 0 ? 10 : face.value),
          style,
        ),
      ),
    [model, style, die.masked, shape],
  );
  const group = useRef<Group>(null);
  const material = useRef<MeshPhysicalMaterial>(null);
  const start = useRef<number | null>(null);
  const spinning = useMemo(() => new Quaternion(), []);
  const tumble = useMemo(() => new Euler(), []);
  useEffect(
    () => () => {
      textures.forEach((t) => t.dispose());
    },
    [textures],
  );
  useEffect(() => () => model.geometry.dispose(), [model]);
  useFrame(({ clock }) => {
    if (material.current)
      material.current.emissiveIntensity =
        style.shimmer * (0.04 + 0.12 * (1 + Math.sin(clock.elapsedTime * 4 + index)));
    if (!group.current) return;
    if (still) {
      group.current.quaternion.copy(final);
      group.current.position.set(target.x, 0, target.z);
      return;
    }
    if (start.current === null) start.current = clock.elapsedTime;
    const pose = rollPose(
      (clock.elapsedTime - start.current) / rollDuration,
      target,
      width,
      height,
      index,
    );
    tumble.set(pose.spin, pose.spin * 0.7, pose.spin * 0.45);
    spinning.setFromEuler(tumble).multiply(final);
    group.current.quaternion.copy(spinning).slerp(final, pose.settle);
    group.current.position.set(pose.x, pose.y, pose.z);
  });
  return (
    <group ref={group} scale={target.scale * (die.kept ? 1 : 0.8)}>
      <mesh geometry={model.geometry}>
        <meshPhysicalMaterial
          ref={material}
          color={style.faceColor}
          transparent={style.opacity < 1}
          opacity={Math.max(0.16, style.opacity)}
          roughness={1 - style.glossiness * 0.86}
          metalness={style.shimmer * 0.25}
          clearcoat={style.glossiness}
          clearcoatRoughness={0.08}
          emissive={style.faceColor}
          emissiveIntensity={style.shimmer * 0.08}
          side={DoubleSide}
          flatShading
        />
      </mesh>
      {model.faces.map((face, i) => {
        const anchor = face.center.clone().addScaledVector(face.normal, 0.033);
        const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), face.normal);
        const width = shape === 20 ? 0.42 : shape === 12 ? 0.48 : shape === 4 ? 0.55 : 0.6;
        return (
          <mesh key={i} position={anchor.toArray()} quaternion={rotation}>
            <planeGeometry args={[width, width]} />
            <meshBasicMaterial
              map={textures[i]}
              transparent
              side={DoubleSide}
              depthWrite={false}
              alphaTest={0.04}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function DiceTable({
  presentation,
  style,
  still,
}: {
  presentation: Presentation;
  style: DiceStyle;
  still: boolean;
}) {
  const { width, height } = useThree((state) => state.viewport);
  const targets = diceLayout(width, height, presentation.dice.length);
  return presentation.dice.map((die, i) => (
    <Die
      key={i}
      die={die}
      style={style}
      index={i}
      still={still}
      target={targets[i]}
      width={width}
      height={height}
    />
  ));
}

function DiceScene({
  presentation,
  style,
  still,
}: {
  presentation: Presentation;
  style: DiceStyle;
  still: boolean;
}) {
  return (
    <Canvas
      orthographic
      dpr={[1, 1.5]}
      camera={{ position: [0, 30, 0], up: [0, 0, -1], zoom: 64, near: 0.1, far: 100 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
    >
      <ambientLight intensity={1.65} />
      <directionalLight position={[2, 7, 5]} intensity={2} />
      <DiceTable presentation={presentation} style={style} still={still} />
    </Canvas>
  );
}

export function DicePreview({ style }: { style: DiceStyle }) {
  const [supported] = useState(hasWebGL);
  return (
    <div className="dice-preview-canvas">
      {supported ? (
        <GraphicsBoundary fallback={<span className="dice-preview-fallback">◈ 20</span>}>
          <DiceScene
            presentation={{
              id: 'preview',
              private: false,
              masked: false,
              dice: [{ sides: 20, value: 20, kept: true, masked: false }],
              overflow: 0,
              total: 20,
            }}
            style={style}
            still
          />
        </GraphicsBoundary>
      ) : (
        <span className="dice-preview-fallback">◈ 20</span>
      )}
    </div>
  );
}

class GraphicsBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function hasWebGL() {
  if (typeof window === 'undefined') return false;
  const canvas = document.createElement('canvas');
  try {
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function DiceOverlay({
  presentation,
  style,
  onDone,
}: {
  presentation: Presentation;
  style: DiceStyle;
  onDone: () => void;
}) {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [supported] = useState(hasWebGL);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const timer = setTimeout(onDone, reduced ? 2500 : 4200);
    return () => clearTimeout(timer);
  }, [onDone, presentation.id, reduced]);
  const fallback = (
    <div className="dice-overlay-fallback" aria-hidden="true">
      {presentation.dice.map((die, i) => (
        <span key={i}>{die.masked ? '?' : die.value}</span>
      ))}
    </div>
  );
  return (
    <div
      className="dice-overlay"
      role="status"
      aria-label={
        presentation.masked ? 'A private roll occurred' : `Dice roll ${presentation.total ?? ''}`
      }
    >
      <div className="dice-overlay-stage">
        {supported ? (
          <GraphicsBoundary fallback={fallback}>
            <DiceScene presentation={presentation} style={style} still={reduced} />
          </GraphicsBoundary>
        ) : (
          fallback
        )}
      </div>
      <div className="dice-overlay-result" aria-hidden="true">
        {presentation.masked ? (
          'Result concealed'
        ) : (
          <>
            {presentation.total !== undefined && (
              <strong>Total: {Number(presentation.total.toFixed(4))}</strong>
            )}
            {presentation.overflow > 0 && (
              <small>+ {presentation.overflow} more dice · see roll history</small>
            )}
          </>
        )}
      </div>
    </div>
  );
}

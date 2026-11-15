'use client';

import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture,
  DoubleSide,
  Group,
  MeshPhysicalMaterial,
  OrthographicCamera,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { buildDieModel, landingRotation, visualSides } from '@/lib/dice-model';
import { diceLayout, type DiceTarget } from '@/lib/dice-motion';
import type { DieVisual, Presentation } from '@/lib/dice-presentation';
import type { DiceStyle } from '@/lib/types';
import { PHYSICS_HZ, simulateDice, type DiceMotion } from '@/lib/dice-physics';
import { baseDiceZoom } from '@/lib/dice-zoom';
import { useDiceZoom } from './use-dice-zoom';

function labelTexture(label: string, style: DiceStyle) {
  // Orientation marks distinguish physical 6/9 faces while tumbling.
  const printed = label === '6' || label === '9' ? `${label}.` : label;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${printed.length > 1 ? 128 : 166}px Arial, sans-serif`;
  ctx.lineWidth = 16;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style.outlineColor;
  ctx.fillStyle = style.numberColor;
  ctx.strokeText(printed, 128, 133);
  ctx.fillText(printed, 128, 133);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function Die({
  die,
  style,
  index,
  still,
  motion,
  startedRef,
  target,
}: {
  die: DieVisual;
  style: DiceStyle;
  index: number;
  still: boolean;
  motion?: DiceMotion;
  startedRef?: { current: number | null };
  target?: DiceTarget;
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
  const nextRotation = useMemo(() => new Quaternion(), []);
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
      group.current.position.set(target?.x ?? 0, 0, target?.z ?? 0);
      return;
    }
    if (!motion || !startedRef) return;
    if (startedRef.current === null) startedRef.current = clock.elapsedTime;
    const frame = Math.min(
      (clock.elapsedTime - startedRef.current) * PHYSICS_HZ,
      motion.frames.length - 1,
    );
    const a = motion.frames[Math.floor(frame)][index];
    const b = motion.frames[Math.min(Math.floor(frame) + 1, motion.frames.length - 1)][index];
    const t = frame % 1;
    group.current.position.set(
      a.position[0] + (b.position[0] - a.position[0]) * t,
      a.position[1] + (b.position[1] - a.position[1]) * t,
      a.position[2] + (b.position[2] - a.position[2]) * t,
    );
    group.current.quaternion.fromArray(a.rotation).slerp(nextRotation.fromArray(b.rotation), t);
  });
  return (
    <group ref={group} scale={target ? target.scale * (die.kept ? 1 : 0.8) : 1}>
      <mesh geometry={model.geometry} castShadow receiveShadow>
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
      {model.faces.flatMap((face, i) => {
        // A physical d4 is read at its top vertex: repeat that value at the
        // three adjacent face corners rather than inventing an upward face.
        const labels =
          shape === 4
            ? model.polygons[i].map((vertexIndex) => {
                const vertex = model.vertices[vertexIndex];
                const opposite = model.faces.reduce((a, b) =>
                  b.normal.dot(vertex) < a.normal.dot(vertex) ? b : a,
                );
                return {
                  anchor: face.center
                    .clone()
                    .lerp(vertex, 0.64)
                    .addScaledVector(face.normal, 0.025),
                  texture: model.faces.indexOf(opposite),
                };
              })
            : [{ anchor: face.center.clone().addScaledVector(face.normal, 0.025), texture: i }];
        return labels.map(({ anchor, texture }, labelIndex) => {
          const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), face.normal);
          const width = shape === 20 ? 0.42 : shape === 12 ? 0.48 : shape === 4 ? 0.32 : 0.6;
          return (
            <mesh key={`${i}:${labelIndex}`} position={anchor.toArray()} quaternion={rotation}>
              <planeGeometry args={[width, width]} />
              <meshBasicMaterial
                map={textures[texture]}
                transparent
                side={DoubleSide}
                depthWrite={false}
                alphaTest={0.04}
              />
            </mesh>
          );
        });
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
    <Die key={i} die={die} style={style} index={i} still={still} target={targets[i]} />
  ));
}

function DiceCameraZoom({ zoom }: { zoom: number }) {
  const get = useThree((state) => state.get);
  const set = useThree((state) => state.set);
  useEffect(() => {
    const { camera, viewport } = get();
    if (!(camera instanceof OrthographicCamera)) return;
    camera.zoom = baseDiceZoom * zoom;
    camera.updateProjectionMatrix();
    set({ viewport: { ...viewport, ...viewport.getCurrentViewport(camera) } });
  }, [get, set, zoom]);
  return null;
}

function DiceScene({
  presentation,
  style,
  still,
  zoom = 1,
  onSettled,
}: {
  presentation: Presentation;
  style: DiceStyle;
  still: boolean;
  zoom?: number;
  onSettled?: () => void;
}) {
  return (
    <Canvas
      orthographic
      dpr={[1, 1.5]}
      shadows
      camera={{
        position: [0, 30, 0],
        up: [0, 0, -1],
        zoom: baseDiceZoom * zoom,
        near: 0.1,
        far: 100,
      }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
    >
      <ambientLight intensity={1.65} />
      <directionalLight
        position={[2, 12, 5]}
        intensity={2}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <DiceCameraZoom zoom={zoom} />
      {still ? (
        <DiceTable presentation={presentation} style={style} still />
      ) : (
        <PhysicalDice presentation={presentation} style={style} onSettled={onSettled} />
      )}
    </Canvas>
  );
}

function PhysicalDice({
  presentation,
  style,
  onSettled,
}: {
  presentation: Presentation;
  style: DiceStyle;
  onSettled?: () => void;
}) {
  const { size, viewport } = useThree();
  // Freeze the tray for a roll: resizing must not restart or alter its trajectory.
  const [motion] = useState(() =>
    simulateDice(presentation.dice, presentation.id, size.width / Math.max(1, size.height), {
      width: viewport.width * 0.96,
      depth: viewport.height * 0.96,
    }),
  );
  const started = useRef<number | null>(null);
  const finished = useRef(false);
  useFrame(({ clock }) => {
    if (
      started.current !== null &&
      !finished.current &&
      clock.elapsedTime - started.current >= motion.duration
    ) {
      finished.current = true;
      onSettled?.();
    }
  });
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[motion.width, motion.depth]} />
        <shadowMaterial transparent opacity={0.18} />
      </mesh>
      {presentation.dice.map((die, index) => (
        <Die
          key={index}
          die={die}
          index={index}
          style={style}
          still={false}
          motion={motion}
          startedRef={started}
        />
      ))}
    </>
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
  const [zoom] = useDiceZoom();
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [supported] = useState(hasWebGL);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const timer = setTimeout(onDone, reduced || settled || !supported ? 2500 : 15000);
    return () => clearTimeout(timer);
  }, [onDone, presentation.id, reduced, settled, supported]);
  const fallback = (
    <div className="dice-overlay-fallback">
      <span>{presentation.masked ? 'Private' : `Total: ${presentation.total}`}</span>
    </div>
  );
  return (
    <div
      className="dice-overlay"
      style={{ '--dice-zoom': zoom } as CSSProperties}
      role="status"
      aria-label={
        presentation.masked ? 'A private roll occurred' : `Dice roll ${presentation.total ?? ''}`
      }
    >
      <div className="dice-overlay-stage">
        {supported ? (
          <GraphicsBoundary fallback={fallback}>
            <DiceScene
              presentation={presentation}
              style={style}
              still={reduced}
              onSettled={() => setSettled(true)}
              zoom={zoom}
            />
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
            {presentation.total !== undefined && (settled || reduced || !supported) && (
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

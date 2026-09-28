'use client';
import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Image as CanvasImage, Circle, Text, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Scene, Snapshot, Token } from '@/lib/types';
import { distance, visibleAt } from '@/lib/geometry';
import type { Command } from '@/lib/commands';
import { movementQueue } from '@/lib/movement';

type Point = { x: number; y: number };
type Mode = 'move' | 'measure' | 'calibrate' | 'reveal' | 'conceal';
type Run = (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
function useImage(url: string | undefined) {
  const [loaded, setLoaded] = useState<{ url: string; image: HTMLImageElement }>();
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    if (!url) return;
    let active = true;
    const image = new window.Image();
    image.onload = () => {
      if (active) setLoaded({ url, image });
    };
    image.onerror = () => {
      if (active) setFailed(url);
    };
    image.src = url;
    return () => {
      active = false;
    };
  }, [url]);
  return {
    image: loaded && loaded.url === url ? loaded.image : undefined,
    failed: !!url && failed === url,
  };
}

function ActorToken({
  token,
  movable,
  move,
  select,
}: {
  token: Token;
  movable: boolean;
  move: (x: number, y: number, revision: number) => Promise<boolean>;
  select: () => void;
}) {
  const { image } = useImage(token.asset_id ? `/api/images/${token.asset_id}` : undefined);
  const [dragPosition, setDragPosition] = useState<Point | null>(null);
  const queue = useRef<ReturnType<typeof movementQueue> | null>(null);
  const lastSent = useRef(0);
  return (
    <Group
      x={dragPosition?.x ?? token.x}
      y={dragPosition?.y ?? token.y}
      draggable={movable}
      opacity={token.hidden ? 0.4 : 1}
      onClick={select}
      onTap={select}
      onDragStart={(e) => {
        setDragPosition(e.target.position());
        queue.current = movementQueue(token.revision, (point, revision) =>
          move(point.x, point.y, revision),
        );
        lastSent.current = 0;
      }}
      onDragMove={(e) => {
        const point = e.target.position();
        setDragPosition(point);
        if (Date.now() - lastSent.current >= 300) {
          lastSent.current = Date.now();
          void queue.current?.move(point);
        }
      }}
      onDragEnd={async (e) => {
        const point = e.target.position();
        setDragPosition(point);
        await queue.current?.move(point);
        setDragPosition(null);
        queue.current = null;
      }}
    >
      <Circle
        radius={token.size / 2 + 3}
        fill="#131e26"
        stroke={movable ? '#dcc39a' : '#8bb9af'}
        strokeWidth={2}
      />
      {image ? (
        <Group
          clipFunc={(ctx) => {
            ctx.arc(0, 0, token.size / 2, 0, Math.PI * 2, false);
          }}
        >
          <CanvasImage
            image={image}
            x={-token.size / 2}
            y={-token.size / 2}
            width={token.size}
            height={token.size}
          />
        </Group>
      ) : (
        <Text
          text={token.label.slice(0, 2).toUpperCase()}
          x={-token.size / 2}
          y={-8}
          width={token.size}
          align="center"
          fill="#f4e6cf"
          fontSize={16}
        />
      )}
      <Text
        text={token.label + (token.hidden ? ' · hidden' : '')}
        x={-80}
        y={token.size / 2 + 9}
        width={160}
        align="center"
        fill="#fff"
        fontSize={12}
        shadowColor="#000"
        shadowBlur={4}
      />
    </Group>
  );
}

export default function Tabletop({
  snapshot,
  run,
  selectActor,
}: {
  snapshot: Snapshot;
  run: Run;
  selectActor: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState<Point>({ x: 50, y: 50 });
  const [mode, setMode] = useState<Mode>('move');
  const [preview, setPreview] = useState(false);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [calibration, setCalibration] = useState('5');
  const [unit, setUnit] = useState('ft');
  const [selected, setSelected] = useState<string>();
  const scene = snapshot.scenes.find((s) => s.id === snapshot.game.active_scene_id);
  const gm = snapshot.role === 'gm';
  const imageUrl = scene
    ? `/api/images/${scene.id}?scene=1&r=${scene.revision}&preview=${preview ? 1 : 0}`
    : undefined;
  const { image, failed } = useImage(imageUrl);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  function fit(s: Scene) {
    const next = Math.min(
      (dimensions.width - 80) / s.width,
      (dimensions.height - 80) / s.height,
      2,
    );
    setScale(Math.max(0.05, next));
    setPosition({
      x: (dimensions.width - s.width * next) / 2,
      y: (dimensions.height - s.height * next) / 2,
    });
  }
  function point(): Point | null {
    const p = stage.current?.getPointerPosition();
    if (!p || !scene) return null;
    return {
      x: Math.min(scene.width, Math.max(0, (p.x - position.x) / scale)),
      y: Math.min(scene.height, Math.max(0, (p.y - position.y) / scale)),
    };
  }
  function down(e: KonvaEventObject<MouseEvent>) {
    if (mode === 'move' || e.evt.button !== 0) return;
    const p = point();
    setStart(p);
    setEnd(p);
    setDrawing(true);
  }
  async function up() {
    setDrawing(false);
    if (!scene || !start || !end || !['reveal', 'conceal'].includes(mode)) return;
    const width = Math.abs(start.x - end.x),
      height = Math.abs(start.y - end.y);
    if (width < 1 || height < 1) return;
    await run('scene_update', {
      id: scene.id,
      revision: scene.revision,
      fog: [
        ...scene.fog,
        {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          width,
          height,
          reveal: mode === 'reveal',
        },
      ],
    });
    setStart(null);
    setEnd(null);
  }
  const selectedToken = snapshot.tokens.find((t) => t.id === selected);
  const renderedTokens = snapshot.tokens.filter(
    (t) => !preview || (!t.hidden && !!scene && visibleAt(scene.fog, t.x, t.y)),
  );
  return (
    <div className="tabletop" ref={container}>
      <div className="canvas-tools">
        <button className={mode === 'move' ? 'active' : ''} onClick={() => setMode('move')}>
          ↖ Move
        </button>
        <button className={mode === 'measure' ? 'active' : ''} onClick={() => setMode('measure')}>
          ↔ Ruler
        </button>
        {gm && (
          <>
            <button
              className={mode === 'calibrate' ? 'active' : ''}
              onClick={() => setMode('calibrate')}
            >
              ⊹ Calibrate
            </button>
            <button className={mode === 'reveal' ? 'active' : ''} onClick={() => setMode('reveal')}>
              ◉ Reveal
            </button>
            <button
              className={mode === 'conceal' ? 'active' : ''}
              onClick={() => setMode('conceal')}
            >
              ◌ Conceal
            </button>
            <button className={preview ? 'active' : ''} onClick={() => setPreview(!preview)}>
              Player view
            </button>
          </>
        )}
      </div>
      {!scene ? (
        <div className="canvas-empty">
          <span className="constellation">◇</span>
          <h2>The world is yours to create.</h2>
          <p>
            {gm
              ? 'Upload a map in Scenes to begin your adventure.'
              : 'Your GM is preparing the next scene.'}
          </p>
        </div>
      ) : (
        <>
          <Stage
            ref={stage}
            width={dimensions.width}
            height={dimensions.height}
            x={position.x}
            y={position.y}
            scaleX={scale}
            scaleY={scale}
            draggable={mode === 'move'}
            onDragEnd={(e) => {
              if (e.target === stage.current) setPosition(e.target.position());
            }}
            onMouseDown={down}
            onMouseMove={() => {
              if (drawing) setEnd(point());
            }}
            onMouseUp={up}
            onMouseLeave={() => {
              if (drawing) void up();
            }}
            onWheel={(e) => {
              e.evt.preventDefault();
              const p = stage.current?.getPointerPosition();
              if (!p) return;
              const next = Math.min(5, Math.max(0.05, scale * (e.evt.deltaY > 0 ? 0.9 : 1.1)));
              setPosition({
                x: p.x - ((p.x - position.x) / scale) * next,
                y: p.y - ((p.y - position.y) / scale) * next,
              });
              setScale(next);
            }}
          >
            <Layer>
              <Rect width={scene.width} height={scene.height} fill="#0d1420" />
              {image && <CanvasImage image={image} width={scene.width} height={scene.height} />}
              {renderedTokens.map((token) => (
                <ActorToken
                  key={token.id}
                  token={token}
                  movable={
                    mode === 'move' && !preview && (gm || token.controller_id === snapshot.userId)
                  }
                  select={() => {
                    setSelected(token.id);
                    selectActor(token.actor_id);
                  }}
                  move={async (x, y, revision) => {
                    return !!(await run('token_update', {
                      id: token.id,
                      revision,
                      x: Math.min(scene.width - 0.01, Math.max(0, x)),
                      y: Math.min(scene.height - 0.01, Math.max(0, y)),
                    }));
                  }}
                />
              ))}
              {start &&
                end &&
                mode !== 'move' &&
                (['reveal', 'conceal'].includes(mode) ? (
                  <Rect
                    x={Math.min(start.x, end.x)}
                    y={Math.min(start.y, end.y)}
                    width={Math.abs(start.x - end.x)}
                    height={Math.abs(start.y - end.y)}
                    fill={mode === 'reveal' ? '#76c9a344' : '#d7808044'}
                    stroke="#f0d7ad"
                    strokeWidth={2 / scale}
                  />
                ) : (
                  <>
                    <Line
                      points={[start.x, start.y, end.x, end.y]}
                      stroke="#f4d8a1"
                      strokeWidth={2 / scale}
                      dash={[8 / scale, 5 / scale]}
                    />
                    <Text
                      x={end.x + 10 / scale}
                      y={end.y}
                      text={`${distance(start, end, scene.units_per_pixel).toFixed(2)} ${scene.unit}`}
                      fill="#fff"
                      fontSize={15 / scale}
                      shadowColor="#000"
                      shadowBlur={5}
                    />
                  </>
                ))}
            </Layer>
          </Stage>
          {!image && (
            <div className="map-loading" role="status">
              {failed ? 'Map could not load. Reload the room to retry.' : 'Preparing map…'}
            </div>
          )}
          <div className="canvas-bottom">
            <span className="scene-label">◈ {scene.name}</span>
            <div className="row">
              <button onClick={() => fit(scene)}>Fit map</button>
              <button aria-label="Zoom out" onClick={() => setScale(Math.max(0.05, scale * 0.8))}>
                −
              </button>
              <span>{Math.round(scale * 100)}%</span>
              <button aria-label="Zoom in" onClick={() => setScale(Math.min(5, scale * 1.2))}>
                +
              </button>
            </div>
          </div>
          {mode === 'calibrate' && gm && (
            <div className="canvas-popover">
              <strong>Calibrate distance</strong>
              <p>Draw a line over a known distance, then enter its length.</p>
              <div className="row">
                <input
                  aria-label="Known distance"
                  type="number"
                  min="0.001"
                  step="any"
                  value={calibration}
                  onChange={(e) => setCalibration(e.target.value)}
                />
                <input
                  aria-label="Distance unit"
                  value={unit}
                  maxLength={20}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </div>
              <button
                disabled={
                  !start || !end || distance(start, end, 1) === 0 || Number(calibration) <= 0
                }
                onClick={async () => {
                  if (start && end) {
                    const data = await run('scene_update', {
                      id: scene.id,
                      revision: scene.revision,
                      units_per_pixel: Number(calibration) / distance(start, end, 1),
                      unit,
                    });
                    if (data) setMode('measure');
                  }
                }}
              >
                Set scale
              </button>
            </div>
          )}
          {gm && selectedToken && mode === 'move' && (
            <div className="canvas-popover">
              <div className="row">
                <strong>{selectedToken.label}</strong>
                <button aria-label="Close token controls" onClick={() => setSelected(undefined)}>
                  ×
                </button>
              </div>
              <label>
                Controller
                <select
                  value={selectedToken.controller_id}
                  onChange={(e) =>
                    run('token_update', {
                      id: selectedToken.id,
                      revision: selectedToken.revision,
                      controller_id: e.target.value,
                    })
                  }
                >
                  {snapshot.members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Token size
                <input
                  type="range"
                  min={16}
                  max={256}
                  defaultValue={selectedToken.size}
                  key={`${selectedToken.id}-${selectedToken.size}`}
                  onPointerUp={(e) =>
                    run('token_update', {
                      id: selectedToken.id,
                      revision: selectedToken.revision,
                      size: Number(e.currentTarget.value),
                    })
                  }
                  onKeyUp={(e) => {
                    if (e.key.startsWith('Arrow'))
                      void run('token_update', {
                        id: selectedToken.id,
                        revision: selectedToken.revision,
                        size: Number(e.currentTarget.value),
                      });
                  }}
                />
              </label>
              <button
                onClick={() =>
                  run('token_update', {
                    id: selectedToken.id,
                    revision: selectedToken.revision,
                    hidden: !selectedToken.hidden,
                  })
                }
              >
                {selectedToken.hidden ? 'Show token' : 'Hide token'}
              </button>
            </div>
          )}
        </>
      )}
      <span className="canvas-hint">
        {mode === 'move'
          ? 'Drag to pan · Scroll to zoom · Drag your token to move'
          : mode === 'measure'
            ? 'Drag to measure a straight-line distance'
            : mode === 'calibrate'
              ? 'Drag between two points with a known distance'
              : 'Drag a rectangle over the map'}
      </span>
    </div>
  );
}

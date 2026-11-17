'use client';
import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Image as CanvasImage, Circle, Text, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Scene, Snapshot, Token } from '@/lib/types';
import { distance, visibleAt } from '@/lib/geometry';
import type { Command } from '@/lib/commands';
import type { useTabletopEdits } from './use-tabletop-edits';
import { portraitCrop, tokenRings } from '@/lib/token-appearance';
import { boardEncounter } from '@/lib/encounter-view';
import { findableTokens } from '@/lib/onboarding';
import { useConfirmedMapCommand, usePlacement } from './use-placement';
import {
  clampView,
  defaultGrid,
  fitView,
  gridLines,
  movementPoint,
  navigationInput,
  zoomView,
  type Grid,
} from '@/lib/navigation';
import { useMapView } from './use-map-view';
import { GridSettings } from './grid-settings';
import { SharedAttention, AttentionMarkers } from './shared-attention';
import type { RoomAttention } from './use-room-attention';

type Point = { x: number; y: number };
type Mode =
  'move' | 'measure' | 'calibrate' | 'reveal' | 'conceal' | 'place' | 'spawn' | 'ping' | 'camera';
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
  quickActions,
  active,
  selected,
  destination,
  distanceLabel,
  gesture,
  zoom,
}: {
  token: Token;
  movable: boolean;
  move: (x: number, y: number, revision: number) => Promise<boolean>;
  select: () => void;
  quickActions: (x: number, y: number) => void;
  active: boolean;
  selected: boolean;
  destination: (p: Point) => Point;
  distanceLabel: (from: Point, to: Point) => string;
  gesture: (active: boolean) => void;
  zoom: number;
}) {
  const { image } = useImage(token.asset_id ? `/api/images/${token.asset_id}` : undefined);
  const [dragPosition, setDragPosition] = useState<Point | null>(null);
  const draggingRevision = useRef(token.revision);
  const [draggingOrigin, setDraggingOrigin] = useState<Point>({ x: token.x, y: token.y });
  return (
    <Group
      x={dragPosition?.x ?? token.x}
      y={dragPosition?.y ?? token.y}
      draggable={movable}
      opacity={token.hidden ? 0.4 : 1}
      onClick={(e) => {
        if (e.evt.button === 0) {
          e.cancelBubble = true;
          select();
        }
      }}
      onTap={select}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        quickActions(e.evt.clientX, e.evt.clientY);
      }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        gesture(true);
        setDragPosition(e.target.position());
        draggingRevision.current = token.revision;
        setDraggingOrigin({ x: token.x, y: token.y });
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const point = destination(e.target.position());
        e.target.position(point);
        setDragPosition(point);
      }}
      onDragEnd={async (e) => {
        e.cancelBubble = true;
        const point = destination(e.target.position());
        e.target.position(point);
        setDragPosition(point);
        try {
          await move(point.x, point.y, draggingRevision.current);
        } finally {
          setDragPosition(null);
          gesture(false);
        }
      }}
    >
      {selected && (
        <Circle radius={token.size / 2 + 7} stroke="#79c9e8" strokeWidth={2} listening={false} />
      )}
      {active && (
        <Circle
          radius={token.size / 2 + 11}
          stroke="#fff4bf"
          strokeWidth={3}
          dash={[6, 4]}
          listening={false}
        />
      )}
      <Circle
        radius={token.size / 2 + 3}
        fill="#131e26"
        stroke={tokenRings[token.ring ?? 'gold'].color}
        strokeWidth={4}
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
            crop={portraitCrop(image.naturalWidth, image.naturalHeight)}
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
        text={token.label + (token.hidden ? ' · hidden' : '') + (active ? ' · current turn' : '')}
        x={-80}
        y={token.size / 2 + 9}
        width={160}
        align="center"
        fill="#fff"
        fontSize={12}
        shadowColor="#000"
        shadowBlur={4}
      />
      {dragPosition && (
        <>
          <Line
            points={[draggingOrigin.x - dragPosition.x, draggingOrigin.y - dragPosition.y, 0, 0]}
            stroke="#fff4bf"
            strokeWidth={2 / zoom}
            dash={[5 / zoom, 4 / zoom]}
            listening={false}
          />
          <Text
            text={distanceLabel(draggingOrigin, dragPosition)}
            x={-120 / zoom}
            y={-token.size / 2 - 28 / zoom}
            width={240 / zoom}
            align="center"
            fill="#fff4bf"
            fontSize={14 / zoom}
            shadowColor="#000"
            shadowBlur={5}
            listening={false}
          />
        </>
      )}
    </Group>
  );
}

function TabletopScene({
  snapshot,
  edits,
  run,
  openQuickActions,
  onPreviewChange,
  children,
  attention,
}: {
  snapshot: Snapshot;
  edits: ReturnType<typeof useTabletopEdits>;
  run: Run;
  openQuickActions: (tokenId: string, anchor: Point) => boolean | void;
  onPreviewChange?: (preview: boolean) => boolean;
  children?: React.ReactNode;
  attention?: RoomAttention;
}) {
  const container = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [mode, setMode] = useState<Mode>('move');
  const [preview, setPreview] = useState(false);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [calibration, setCalibration] = useState('5');
  const [unit, setUnit] = useState('ft');
  const [selected, setSelected] = useState<string>();
  const [placingActor, setPlacingActor] = useState('');
  const [placementX, setPlacementX] = useState('0');
  const [placementY, setPlacementY] = useState('0');
  const [setupMessage, setSetupMessage] = useState('');
  const scene = snapshot.scenes.find((s) => s.id === snapshot.game.active_scene_id);
  const scope = `${snapshot.userId}:${snapshot.game.id}:${scene?.id ?? 'none'}`;
  const { view, update: updateView } = useMapView(scope, scene, dimensions);
  const { scale, ...position } = view;
  const setPosition = (p: Point) => updateView({ ...p, scale });
  const [spacePan, setSpacePan] = useState(false);
  const spaceHeld = useRef(false);
  const tokenGesture = useRef(false);
  const pointerGesture = useRef(false);
  const [showGrid, setShowGrid] = useState(false);
  const [snap, setSnap] = useState(false);
  const grid = scene?.grid ?? defaultGrid;
  const gridEdits = useConfirmedMapCommand(scope, run, 'scene_grid');
  const placement = usePlacement(scope, run);
  const mapBlocked = edits.blocked || gridEdits.blocked || placement.blocked;
  const findable = findableTokens(snapshot);
  const gm = snapshot.role === 'gm';
  const encounter = boardEncounter(snapshot);
  const imageUrl = scene
    ? `/api/images/${scene.id}?scene=1&r=${scene.revision}&preview=${preview ? 1 : 0}`
    : undefined;
  const { image, failed } = useImage(imageUrl);
  useEffect(() => {
    function down(e: KeyboardEvent) {
      if (
        e.code !== 'Space' ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        navigationInput(e.target) ||
        tokenGesture.current ||
        pointerGesture.current
      )
        return;
      if (e.target !== document.body && !container.current?.contains(e.target as Node)) return;
      e.preventDefault();
      spaceHeld.current = true;
      setSpacePan(true);
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeld.current = false;
        if (!pointerGesture.current) setSpacePan(false);
      }
    };
    const blur = () => {
      spaceHeld.current = false;
      setSpacePan(false);
      pointerGesture.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    const controlsObserver = new ResizeObserver(([entry]) => {
      element.style.setProperty('--tabletop-controls-height', `${entry.contentRect.height}px`);
    });
    if (controls.current) controlsObserver.observe(controls.current);
    return () => {
      observer.disconnect();
      controlsObserver.disconnect();
    };
  }, []);
  function fit(s: Scene) {
    updateView(fitView(s, dimensions));
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
    pointerGesture.current = true;
    if (spacePan) return;
    if (mode === 'move' || e.evt.button !== 0) return;
    if (mode === 'ping' || mode === 'camera') {
      const p = point();
      if (p && scene && !preview) void attention?.send(mode, p, scene);
      setMode('move');
      return;
    }
    if (mode === 'place' || mode === 'spawn') {
      const p = point();
      if (p) void placeAt(p);
      return;
    }
    if (mapBlocked && ['reveal', 'conceal'].includes(mode)) return;
    const p = point();
    setStart(p);
    setEnd(p);
    setDrawing(true);
  }
  async function placeAt(p?: Point, spawn = mode === 'spawn') {
    if (!scene || preview || mapBlocked) return;
    if (
      p &&
      (!Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x >= scene.width ||
        p.y >= scene.height)
    ) {
      setSetupMessage('Choose a point inside the map.');
      return;
    }
    if (spawn) {
      if (!gm || !p) return;
      const result = await run('party_spawn', {
        scene_id: scene.id,
        revision: scene.revision,
        ...p,
      });
      if (result) {
        setMode('move');
        setSetupMessage('Party spawn saved. Reveal this area before players place characters.');
      }
    } else if (
      placingActor &&
      snapshot.actors.some((a) => a.id === placingActor && (gm || a.owner_id === snapshot.userId))
    ) {
      const confirmed = await placement.commit({
        scene_id: scene.id,
        actor_id: placingActor,
        revision: scene.revision,
        ...p,
      });
      if (confirmed) setMode('move');
    }
  }
  function centerToken(id: string) {
    if (preview) return;
    const token = findable.find((t) => t.id === id);
    if (!token) return;
    setPosition({
      x: dimensions.width / 2 - token.x * scale,
      y: dimensions.height / 2 - token.y * scale,
    });
    setSelected(token.id);
  }
  async function up() {
    pointerGesture.current = false;
    setSpacePan(spaceHeld.current);
    setDrawing(false);
    if (!drawing || spacePan) return;
    if (!scene || !start || !end || !['reveal', 'conceal'].includes(mode)) return;
    const width = Math.abs(start.x - end.x),
      height = Math.abs(start.y - end.y);
    if (width < 1 || height < 1) return;
    if (mapBlocked) return;
    await edits.commit('tabletop_fog', {
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
  const renderedTokens = snapshot.tokens.filter(
    (t) =>
      t.scene_id === scene?.id &&
      (!preview || (!t.hidden && !!scene && visibleAt(scene.fog, t.x, t.y))),
  );
  function choose(token: Token, anchor?: Point) {
    if (preview || spacePan || mode !== 'move') return;
    const rect = container.current?.getBoundingClientRect();
    const accepted = openQuickActions(
      token.id,
      anchor ?? {
        x: (rect?.left ?? 0) + position.x + token.x * scale + (token.size * scale) / 2,
        y: (rect?.top ?? 0) + position.y + token.y * scale,
      },
    );
    if (accepted !== false) setSelected(token.id);
  }
  return (
    <div className="tabletop" ref={container} tabIndex={0} aria-label="Tabletop map">
      <div className="tabletop-controls" ref={controls}>
        <div className="canvas-tools" aria-label="Map setup controls" tabIndex={-1}>
          {scene && (
            <button onClick={() => fit(scene)} title="Fit the whole map in your viewport">
              Fit map / Reset view
            </button>
          )}
          <details className="map-help">
            <summary>Map help &amp; shortcuts</summary>
            <div className="map-help-content">
              <p>
                Fit map / Reset view shows the whole map. Find my character centers only your
                visible active-scene token; choose explicitly when there are several.
              </p>
              <p>
                Drag empty map to pan in Move mode. Hold Space before dragging to pan in any tool,
                even over tokens. Release Space to return to your tool. Typing and active token
                drags are never intercepted.
              </p>
              <p>
                Scroll to zoom around the pointer; +/− buttons zoom around the viewport center. Drag
                your token to see straight-line Euclidean distance (diagonals use √(x²+y²)), not
                path length or a movement allowance. Walls, terrain and speed remain manual.
              </p>
              <p>
                Enable Snap to grid for cell-center movement; turn it off for free movement. GM grid
                size/origin are shared; scale uses Calibrate. Uncalibrated distances are estimates.
              </p>
              <p>
                Ctrl/Cmd+Z undoes eligible map edits outside text inputs. Your view is remembered
                only in this browser per user/game/scene; Reset view recovers an awkward view.
              </p>
            </div>
          </details>
          {scene && (
            <>
              <label className="map-snap">
                <input
                  type="checkbox"
                  checked={snap}
                  disabled={!grid.enabled}
                  onChange={(e) => setSnap(e.target.checked)}
                />{' '}
                Snap to grid
              </label>
              {gm && (
                <button disabled={preview || mapBlocked} onClick={() => setShowGrid(!showGrid)}>
                  Grid settings
                </button>
              )}
              <span className="small muted">
                Distance: Euclidean ·{' '}
                {scene.calibrated
                  ? `${scene.units_per_pixel} ${scene.unit}/px`
                  : 'uncalibrated estimate'}
              </span>
            </>
          )}
          {findable.length === 1 ? (
            <button
              disabled={preview}
              title="Center on my token in visible space"
              onClick={() => centerToken(findable[0].id)}
            >
              Find my character
            </button>
          ) : (
            <select
              aria-label="Find my character"
              title="Center on my token in visible space"
              value=""
              disabled={preview || !findable.length}
              onChange={(e) => centerToken(e.target.value)}
            >
              <option value="">Find my character…</option>
              {findable.map((t, i) => (
                <option key={t.id} value={t.id}>
                  {t.label} · token {i + 1}
                </option>
              ))}
            </select>
          )}
          {!findable.length && (
            <span className="small muted">
              No visible controlled character here. Ask the GM about absent, other-scene, or
              concealed tokens.
            </span>
          )}
          {scene && (
            <>
              <select
                aria-label="Place character"
                value={placingActor}
                disabled={preview || placement.blocked}
                onChange={(e) => setPlacingActor(e.target.value)}
              >
                <option value="">Place character…</option>
                {snapshot.actors
                  .filter((a) => gm || (a.owner_id === snapshot.userId && a.kind === 'character'))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
              <button
                disabled={preview || !placingActor || mapBlocked}
                onClick={() => setMode('place')}
              >
                Click to place
              </button>
              <button
                disabled={preview || !placingActor || mapBlocked}
                onClick={() => void placeAt(undefined, false)}
              >
                Place at party spawn
              </button>
              {gm && (
                <button disabled={preview || mapBlocked} onClick={() => setMode('spawn')}>
                  Set party spawn
                </button>
              )}
            </>
          )}
          <select
            aria-label="Token quick actions"
            disabled={preview || mode !== 'move'}
            title={
              preview
                ? 'Token actions are disabled in player preview.'
                : 'Select Move mode to use token actions.'
            }
            value=""
            onChange={(e) => {
              const token = renderedTokens.find((t) => t.id === e.target.value);
              if (token) choose(token, { x: 24, y: 140 });
            }}
          >
            <option value="">Token quick actions…</option>
            {renderedTokens.map((token) => (
              <option key={token.id} value={token.id}>
                {token.label}
              </option>
            ))}
          </select>
          <button
            disabled={mapBlocked || !edits.entry}
            onClick={() => void edits.undo()}
            title="Ctrl/Cmd+Z. Last 20 moves/fog edits, within 24 hours, in this scene."
          >
            Undo{edits.entry ? `: ${edits.entry.description}` : ''}
          </button>
          {edits.uncertain && (
            <>
              <button onClick={() => void edits.retry()}>Retry tabletop change</button>
              <button onClick={edits.dismiss}>Dismiss attempt</button>
            </>
          )}
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
              <button
                className={mode === 'reveal' ? 'active' : ''}
                onClick={() => setMode('reveal')}
              >
                ◉ Reveal
              </button>
              <button
                className={mode === 'conceal' ? 'active' : ''}
                onClick={() => setMode('conceal')}
              >
                ◌ Conceal
              </button>
              <button
                className={preview ? 'active' : ''}
                onClick={() => {
                  if (onPreviewChange?.(!preview) === false) return;
                  setMode('move');
                  setSelected(undefined);
                  setPreview(!preview);
                }}
              >
                Player view
              </button>
            </>
          )}
        </div>
        {attention && scene && (
          <SharedAttention
            attention={attention}
            snapshot={snapshot}
            scene={scene}
            preview={preview}
            selectMode={setMode}
            center={(point) =>
              setPosition({
                x: dimensions.width / 2 - point.x * scale,
                y: dimensions.height / 2 - point.y * scale,
              })
            }
          />
        )}
        <div className="tabletop-undo-status" role="status">
          {placement.message}
          {setupMessage && <p>{setupMessage}</p>}
          {placement.uncertain && (
            <>
              <button onClick={() => void placement.retry()}>Retry placement</button>
              <button onClick={placement.dismiss}>Dismiss placement attempt</button>
            </>
          )}
          {edits.message}
          {gridEdits.message}
          {gridEdits.uncertain && (
            <>
              <button disabled={preview} onClick={() => void gridEdits.retry()}>
                Retry grid change
              </button>
              <button onClick={gridEdits.dismiss}>Dismiss grid attempt</button>
            </>
          )}
          <details>
            <summary>Undo limits</summary>
            Last 20 committed token moves and fog edits per user/game, for 24 hours. Only this scene
            is shown. Later changes or lost permission can block undo. Grid, scale, visibility,
            size, control, creation and deletion are not undoable. Undo cannot erase information
            players already saw.
          </details>
        </div>
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
            draggable={mode === 'move' || spacePan}
            dragBoundFunc={(p) => {
              const { x, y } = clampView({ ...p, scale }, scene, dimensions);
              return { x, y };
            }}
            onDragEnd={(e) => {
              if (e.target === stage.current) setPosition(e.target.position());
            }}
            onMouseDown={down}
            onMouseMove={() => {
              if (drawing) setEnd(point());
            }}
            onMouseUp={up}
            onMouseLeave={() => {
              pointerGesture.current = false;
              setSpacePan(spaceHeld.current);
              if (drawing) void up();
            }}
            onWheel={(e) => {
              e.evt.preventDefault();
              const p = stage.current?.getPointerPosition();
              if (!p) return;
              updateView(zoomView(view, p, scale * (e.evt.deltaY > 0 ? 0.9 : 1.1)));
            }}
          >
            <Layer>
              <Rect width={scene.width} height={scene.height} fill="#0d1420" />
              {image && <CanvasImage image={image} width={scene.width} height={scene.height} />}
              {grid.enabled && (
                <Group
                  listening={false}
                  clipX={0}
                  clipY={0}
                  clipWidth={scene.width}
                  clipHeight={scene.height}
                >
                  {gridLines(scene.width, grid.size, grid.origin_x).map((x) => (
                    <Line
                      key={`x${x}`}
                      points={[x, 0, x, scene.height]}
                      stroke="#c1d6e8"
                      opacity={0.35}
                      strokeWidth={1 / scale}
                    />
                  ))}
                  {gridLines(scene.height, grid.size, grid.origin_y).map((y) => (
                    <Line
                      key={`y${y}`}
                      points={[0, y, scene.width, y]}
                      stroke="#c1d6e8"
                      opacity={0.35}
                      strokeWidth={1 / scale}
                    />
                  ))}
                </Group>
              )}
              {gm && !preview && snapshot.onboarding?.spawn && (
                <Group
                  listening={false}
                  x={snapshot.onboarding.spawn.x}
                  y={snapshot.onboarding.spawn.y}
                >
                  <Circle radius={18} stroke="#79c9e8" strokeWidth={2} dash={[4, 4]} />
                  <Text
                    text="Party spawn"
                    x={-50}
                    y={22}
                    width={100}
                    align="center"
                    fill="#fff"
                    fontSize={12}
                  />
                </Group>
              )}
              {renderedTokens.map((token) => (
                <ActorToken
                  active={encounter?.status === 'active' && encounter.active_token_id === token.id}
                  key={`${scene.id}:${token.id}`}
                  token={token}
                  selected={!preview && selected === token.id}
                  zoom={scale}
                  quickActions={(x, y) => choose(token, { x, y })}
                  movable={
                    !spacePan &&
                    !mapBlocked &&
                    mode === 'move' &&
                    !preview &&
                    (gm || token.controller_id === snapshot.userId)
                  }
                  destination={(p) => movementPoint(p, scene, grid, snap)}
                  distanceLabel={(from, to) =>
                    `${distance(from, to, scene.units_per_pixel).toFixed(2)} ${scene.unit} · Euclidean${scene.calibrated ? '' : ' · estimate'}`
                  }
                  gesture={(active) => {
                    tokenGesture.current = active;
                  }}
                  select={() => {
                    choose(token);
                  }}
                  move={async (x, y, revision) => {
                    return edits.commit('tabletop_move', {
                      id: token.id,
                      revision,
                      x: Math.min(scene.width - 0.01, Math.max(0, x)),
                      y: Math.min(scene.height - 0.01, Math.max(0, y)),
                    });
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
                      text={`${distance(start, end, scene.units_per_pixel).toFixed(2)} ${scene.unit} · Euclidean${scene.calibrated ? '' : ' · estimate'}`}
                      fill="#fff"
                      fontSize={15 / scale}
                      shadowColor="#000"
                      shadowBlur={5}
                    />
                  </>
                ))}
            </Layer>
          </Stage>
          {attention && !preview && (
            <AttentionMarkers signals={attention.signals} snapshot={snapshot} view={view} />
          )}
          {!image && (
            <div className="map-loading" role="status">
              {failed ? 'Map could not load. Reload the room to retry.' : 'Preparing map…'}
            </div>
          )}
          <div className="canvas-bottom">
            <span className="scene-label">◈ {scene.name}</span>
            <div className="row">
              <button onClick={() => fit(scene)}>Fit map</button>
              <button
                aria-label="Zoom out"
                onClick={() =>
                  updateView(
                    zoomView(
                      view,
                      { x: dimensions.width / 2, y: dimensions.height / 2 },
                      scale * 0.8,
                    ),
                  )
                }
              >
                −
              </button>
              <span>{Math.round(scale * 100)}%</span>
              <button
                aria-label="Zoom in"
                onClick={() =>
                  updateView(
                    zoomView(
                      view,
                      { x: dimensions.width / 2, y: dimensions.height / 2 },
                      scale * 1.2,
                    ),
                  )
                }
              >
                +
              </button>
            </div>
          </div>
          {showGrid && gm && !preview && (
            <GridSettings
              key={scene.id}
              scene={scene}
              blocked={mapBlocked}
              close={() => setShowGrid(false)}
              save={(grid: Grid, revision: number) =>
                gridEdits.commit({ scene_id: scene.id, revision, grid })
              }
            />
          )}
          {(mode === 'place' || mode === 'spawn') && !preview && (
            <div className="canvas-popover">
              <strong>{mode === 'spawn' ? 'Set party spawn' : 'Place character'}</strong>
              <p>
                Click the map, or enter map pixel coordinates. Players can only place in revealed
                space. Without a spawn, the map center is used. Placement is not undoable.
              </p>
              {gm && (
                <p className="small muted">
                  Linked tokens share sheet state. Use Add independent creatures for separate
                  enemies.
                </p>
              )}
              <label>
                X{' '}
                <input
                  aria-label="Placement X"
                  type="number"
                  min="0"
                  max={scene.width - 0.01}
                  step="any"
                  value={placementX}
                  onChange={(e) => setPlacementX(e.target.value)}
                />
              </label>
              <label>
                Y{' '}
                <input
                  aria-label="Placement Y"
                  type="number"
                  min="0"
                  max={scene.height - 0.01}
                  step="any"
                  value={placementY}
                  onChange={(e) => setPlacementY(e.target.value)}
                />
              </label>
              <button
                disabled={
                  placement.blocked ||
                  !placementX ||
                  !placementY ||
                  !Number.isFinite(Number(placementX)) ||
                  !Number.isFinite(Number(placementY))
                }
                onClick={() => void placeAt({ x: Number(placementX), y: Number(placementY) })}
              >
                Confirm position
              </button>
              <button onClick={() => setMode('move')}>Cancel placement</button>
            </div>
          )}
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
                  mapBlocked ||
                  preview ||
                  !start ||
                  !end ||
                  distance(start, end, 1) === 0 ||
                  !Number.isFinite(Number(calibration)) ||
                  Number(calibration) <= 0 ||
                  !unit.trim()
                }
                onClick={async () => {
                  if (start && end) {
                    const data = await run('scene_calibrate', {
                      scene_id: scene.id,
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
        </>
      )}
      <span className="canvas-hint">
        {mode === 'move'
          ? preview
            ? 'Player preview · token actions disabled'
            : 'Click token for actions · Drag to pan · Scroll to zoom · Drag your token to move'
          : mode === 'ping' || mode === 'camera'
            ? 'Click revealed map space to share attention · numeric controls available · Move cancels'
            : mode === 'place' || mode === 'spawn'
              ? 'Click the map to choose a starting point · numeric controls available'
              : mode === 'measure'
                ? 'Drag to measure a straight-line distance'
                : mode === 'calibrate'
                  ? 'Drag between two points with a known distance'
                  : 'Drag a rectangle over the map'}
      </span>
      {children}
    </div>
  );
}

export default function Tabletop(props: React.ComponentProps<typeof TabletopScene>) {
  return (
    <TabletopScene
      key={`${props.snapshot.userId}:${props.snapshot.game.id}:${props.snapshot.game.active_scene_id}`}
      {...props}
    />
  );
}

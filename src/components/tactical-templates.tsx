'use client';
import { useState } from 'react';
import {
  areaLabel,
  areaPath,
  areaSchema,
  type Area,
  type SharedArea,
} from '@/lib/tactical-templates';
import { visibleAt } from '@/lib/geometry';
import type { Snapshot } from '@/lib/types';
import type { Command } from '@/lib/commands';
import { useConfirmedMapCommand } from './use-placement';

type Run = (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
const defaults = { kind: 'circle', x: '0', y: '0', size: '20', width: '5', rotation: '0' };
export function useTacticalTemplates(snapshot: Snapshot, run: Run, preview: boolean) {
  const scene = snapshot.scenes.find((s) => s.id === snapshot.game.active_scene_id);
  const scope = `${snapshot.userId}:${snapshot.game.id}:${scene?.id ?? 'none'}`;
  const edits = useConfirmedMapCommand(scope, run, 'tactical_template');
  const [fields, setFields] = useState(defaults);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<{ owner_id: string; revision: number }>();
  const [sourceRevision, setSourceRevision] = useState<number>();
  // A scene edit invalidates a private preview as well as published areas.
  const [draftRevision, setDraftRevision] = useState(scene?.revision);
  const parsed = areaSchema.safeParse({
    kind: fields.kind,
    ...Object.fromEntries(
      Object.entries(fields)
        .filter(([k]) => k !== 'kind')
        .map(([k, v]) => [k, v.trim() ? Number(v) : NaN]),
    ),
  });
  const area = parsed.success ? parsed.data : undefined;
  const valid = !!scene?.calibrated && !!area && area.x < scene.width && area.y < scene.height;
  const slots = (snapshot.tacticalTemplates ?? []).filter((t) => t.scene_id === scene?.id);
  const shared = slots.filter(
    (t) =>
      t.area && t.scene_revision === scene?.revision && visibleAt(scene.fog, t.area.x, t.area.y),
  );
  const ownerName = (id: string) =>
    snapshot.members.find((m) => m.user_id === id)?.display_name ?? 'Member';
  const disabled = preview || edits.blocked;
  const privateArea =
    !preview && show && valid && draftRevision === scene?.revision ? area : undefined;
  function change(key: keyof typeof defaults, value: string) {
    if (disabled) return;
    setFields((f) => ({ ...f, [key]: value }));
    setDraftRevision(scene?.revision);
  }
  function place(point: { x: number; y: number }) {
    if (disabled) return;
    if (!show) setSourceRevision(slots.find((t) => t.owner_id === snapshot.userId)?.revision ?? 0);
    setFields((f) => ({ ...f, x: point.x.toFixed(2), y: point.y.toFixed(2) }));
    setDraftRevision(scene?.revision);
    setShow(true);
  }
  function load(t: SharedArea) {
    if (!t.area || disabled) return;
    setEditing({ owner_id: t.owner_id, revision: t.revision });
    setFields(
      Object.fromEntries(Object.entries(t.area).map(([k, v]) => [k, String(v)])) as typeof defaults,
    );
    setDraftRevision(scene?.revision);
    setShow(true);
  }
  async function publish() {
    if (!scene || !privateArea || disabled) return;
    const target = editing ?? {
      owner_id: snapshot.userId,
      revision: sourceRevision ?? 0,
    };
    if (
      await edits.commit({
        ...target,
        scene_id: scene.id,
        scene_revision: scene.revision,
        area: privateArea,
      })
    ) {
      setShow(false);
      setEditing(undefined);
    }
  }
  async function dismiss(t: SharedArea) {
    if (!scene || disabled) return;
    await edits.commit({
      owner_id: t.owner_id,
      revision: t.revision,
      scene_id: scene.id,
      scene_revision: scene.revision,
      area: null,
    });
  }
  return {
    scene,
    fields,
    change,
    place,
    load,
    publish,
    dismiss,
    shared,
    ownerName,
    disabled,
    canEdit: (owner: string) => owner === snapshot.userId || snapshot.role === 'gm',
    privateArea,
    valid,
    edits,
    preview,
    editing,
    showPreview: () => {
      if (!show)
        setSourceRevision(slots.find((t) => t.owner_id === snapshot.userId)?.revision ?? 0);
      setShow(true);
      setDraftRevision(scene?.revision);
    },
    clear: () => {
      setShow(false);
      setEditing(undefined);
    },
  };
}
type Tools = ReturnType<typeof useTacticalTemplates>;

export function TacticalTemplateTools({
  tools: t,
  selectOrigin,
}: {
  tools: Tools;
  selectOrigin: () => void;
}) {
  if (!t.scene) return null;
  return (
    <details className="tactical-template-tools">
      <summary>Spell templates</summary>
      <p>
        Private preview first. One shared area per member per scene. Sharing replaces your area;
        edits remain private until shared.
      </p>
      {!t.scene.calibrated && (
        <p role="status">Ask the GM to calibrate the map before using spell templates.</p>
      )}
      <fieldset disabled={t.disabled || !t.scene.calibrated}>
        <legend>
          {t.editing
            ? `Editing ${t.ownerName(t.editing.owner_id)}’s area (private draft)`
            : 'Private area draft'}
        </legend>
        <label>
          Shape{' '}
          <select
            aria-label="Template shape"
            value={t.fields.kind}
            onChange={(e) => t.change('kind', e.target.value)}
          >
            {['circle', 'cone', 'line', 'cube'].map((kind) => (
              <option key={kind}>{kind}</option>
            ))}
          </select>
        </label>
        {(['x', 'y', 'size', 'width', 'rotation'] as const)
          .filter((key) => key !== 'width' || t.fields.kind === 'line')
          .map((key) => (
            <label key={key}>
              {key === 'size'
                ? `Dimension (${t.scene!.unit})`
                : key === 'width'
                  ? `Width (${t.scene!.unit})`
                  : key === 'rotation'
                    ? 'Rotation (degrees)'
                    : `Origin ${key.toUpperCase()} (map pixels)`}
              <input
                type="number"
                step="any"
                aria-label={`Template ${key}`}
                value={t.fields[key]}
                onChange={(e) => t.change(key, e.target.value)}
              />
            </label>
          ))}
        <button onClick={selectOrigin}>Click template origin</button>
        <button disabled={!t.valid} onClick={t.showPreview}>
          Preview privately
        </button>
        <button disabled={!t.privateArea} onClick={() => void t.publish()}>
          Share template with everyone
        </button>
        <button onClick={t.clear}>Dismiss private preview</button>
      </fieldset>
      <p>
        Circle: radius. Cone: 90° sector length. Line: length × width, origin at start. Cube:
        centered square side. Clockwise rotation from map-right. Grid-independent; no snapping or
        cell/creature selection. Mathematical boundary included; targeting and rules remain
        manual/overridable. Areas are clipped to map bounds, not obstacles. Only revealed origins
        may be shared, even by the GM. Map edits hide shared areas until explicitly reshared.
        Templates persist across reconnect; dismissal is not Undo.
      </p>
      <div role="status">{t.edits.message}</div>
      {t.edits.uncertain && (
        <>
          <button disabled={t.preview} onClick={() => void t.edits.retry()}>
            Retry template change
          </button>
          <button onClick={t.edits.dismiss}>Dismiss template attempt</button>
        </>
      )}
      <ul aria-label="Shared spell templates">
        {t.shared.map((s) => (
          <li key={s.owner_id}>
            {t.ownerName(s.owner_id)} · {areaLabel(s.area!, t.scene!.unit)} · origin {s.area!.x},{' '}
            {s.area!.y}
            {s.owner_id === t.editing?.owner_id && <span> · editing privately</span>}
            {t.canEdit(s.owner_id) && (
              <>
                <button disabled={t.disabled} onClick={() => t.load(s)}>
                  Move/edit {t.ownerName(s.owner_id)} template
                </button>
                <button disabled={t.disabled} onClick={() => void t.dismiss(s)}>
                  Dismiss {t.ownerName(s.owner_id)} shared template
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function TacticalTemplateOverlay({
  tools: t,
  view,
}: {
  tools: Tools;
  view: { x: number; y: number; scale: number };
}) {
  if (!t.scene || t.preview) return null;
  const scene = t.scene;
  const areas: { key: string; area: Area; label: string; private: boolean }[] = t.shared.map(
    (s) => ({
      key: s.owner_id,
      area: s.area!,
      label: `${t.ownerName(s.owner_id)} · Shared`,
      private: false,
    }),
  );
  if (t.privateArea)
    areas.push({
      key: 'private',
      area: t.privateArea,
      label: 'Only you · Private preview',
      private: true,
    });
  return (
    <svg
      className="tactical-template-overlay"
      aria-label="Spell areas"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <svg
        x={view.x}
        y={view.y}
        width={scene.width * view.scale}
        height={scene.height * view.scale}
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        overflow="hidden"
      >
        {areas.map(({ key, area, label, private: local }) => (
          <g key={key} transform={`translate(${area.x} ${area.y})`}>
            <title>
              {label} · {areaLabel(area, scene.unit)} · origin {area.x}, {area.y}
            </title>
            <path
              d={areaPath(area, scene.units_per_pixel)}
              transform={`rotate(${area.rotation})`}
              fill={local ? '#ffe1a022' : '#a4e2ff22'}
              stroke="#fff"
              strokeWidth={2 / view.scale}
              strokeDasharray={local ? `${6 / view.scale} ${4 / view.scale}` : undefined}
            />
            <path d="M -5 0 H 5 M 0 -5 V 5" stroke="#fff" strokeWidth={2 / view.scale} />
            <text
              y={-10 / view.scale}
              fontSize={12 / view.scale}
              fill="#fff"
              stroke="#101820"
              strokeWidth={3 / view.scale}
              paintOrder="stroke"
            >
              {label} · {areaLabel(area, scene.unit)}
            </text>
          </g>
        ))}
      </svg>
    </svg>
  );
}

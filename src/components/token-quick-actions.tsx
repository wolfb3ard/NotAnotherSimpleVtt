'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Actor, Sheet, Snapshot, Token } from '@/lib/types';
import type { Command } from '@/lib/commands';
import { QuickResources } from './quick-resources';
import { CreatureAdder } from './creature-adder';
import { CombatControls } from './combat-controls';
import { tableSystem } from '@/lib/table-system';
import { TokenInitiative } from './token-initiative';
import { PlayAssistance } from './play-assistance';

const noRefresh = async () => {};

export function TokenQuickActions({
  token,
  actor,
  snapshot,
  anchor,
  blocked,
  busy,
  run,
  onBusyChange,
  onCommitted,
  onClose,
  onSheet,
  onRoll,
  onAdvancedRoll,
  refresh = noRefresh,
  visibility = 'public',
  onVisibilityChange,
  rollPending = false,
}: {
  token: Token;
  actor?: Actor;
  snapshot: Snapshot;
  anchor: { x: number; y: number };
  blocked: boolean;
  busy: boolean;
  run: (command: Command, payload: unknown) => Promise<Record<string, string> | undefined>;
  onBusyChange: (busy: boolean) => void;
  onCommitted: (sheet: Sheet, revision: number, name?: string) => void;
  onClose: () => void;
  onSheet: () => void;
  onRoll?: (roll: { actorId: string; expression: string; rollType: string }) => Promise<void>;
  onAdvancedRoll?: (roll: { actorId: string; expression: string; rollType: string }) => void;
  refresh?: () => Promise<void>;
  visibility?: 'public' | 'private';
  onVisibilityChange?: (value: 'public' | 'private') => void;
  rollPending?: boolean;
}) {
  const title = useId();
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [position, setPosition] = useState(anchor);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [combatBusy, setCombatBusy] = useState(false);
  const [assistanceBusy, setAssistanceBusy] = useState(false);
  const [initiativeBusy, setInitiativeBusy] = useState(false);
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const actionLock = useRef(false);
  const [actionMessage, setActionMessage] = useState('');
  const [mode, setMode] = useState('normal');
  const [chosenRoll, setChosenRoll] = useState('');
  const system = tableSystem(snapshot.game);
  const rolls = actor ? system.rolls(actor.sheet) : [];
  const ac = actor && system.armorClass(actor.sheet);
  const selectedRoll =
    rolls.find((r) => r.id === chosenRoll) ??
    rolls.find((r) => /\battack\b/i.test(r.name)) ??
    rolls[0];
  const selectedExpression =
    mode === 'normal'
      ? selectedRoll?.expression
      : selectedRoll?.expression.replace(/^1d20\b/, mode === 'advantage' ? '2d20kh1' : '2d20kl1');
  const rollable =
    !!actor &&
    (snapshot.role === 'gm' ||
      actor.owner_id === snapshot.userId ||
      snapshot.tokens.some((t) => t.actor_id === actor.id && t.controller_id === snapshot.userId));
  const locked =
    blocked ||
    busy ||
    resourceBusy ||
    combatBusy ||
    assistanceBusy ||
    initiativeBusy ||
    duplicateBusy ||
    actionBusy ||
    rollPending;
  useEffect(
    () =>
      onBusyChange(
        resourceBusy ||
          combatBusy ||
          assistanceBusy ||
          initiativeBusy ||
          duplicateBusy ||
          actionBusy ||
          rollPending,
      ),
    [
      resourceBusy,
      combatBusy,
      assistanceBusy,
      initiativeBusy,
      duplicateBusy,
      actionBusy,
      rollPending,
      onBusyChange,
    ],
  );
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const editable =
    !!actor &&
    (snapshot.role === 'gm' ||
      actor.owner_id === snapshot.userId ||
      snapshot.grants.some(
        (g) => g.actor_id === actor.id && g.user_id === snapshot.userId && g.can_edit,
      ));
  async function updateToken(extra: Record<string, unknown>) {
    if (locked || actionLock.current || snapshot.role !== 'gm') return;
    actionLock.current = true;
    setActionBusy(true);
    setActionMessage('Saving token…');
    try {
      const result = await run('token_update', {
        id: token.id,
        revision: token.revision,
        ...extra,
      });
      setActionMessage(
        result
          ? 'Token saved.'
          : 'Token change unconfirmed. Review the refreshed token before trying again.',
      );
    } catch {
      setActionMessage('Token change unconfirmed. Review the refreshed token before trying again.');
    } finally {
      actionLock.current = false;
      setActionBusy(false);
    }
  }
  function move(x: number, y: number) {
    const rect = frame.current?.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - (rect?.width ?? 320) - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - (rect?.height ?? 420) - 8)),
    });
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    frame.current?.focus();
    // Clamp the requested pointer anchor after measuring the actual card.
    const rect = frame.current?.getBoundingClientRect();
    if (rect)
      setPosition({
        x: Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8)),
      });
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [anchor.x, anchor.y]);
  useEffect(() => {
    function resize() {
      const rect = frame.current?.getBoundingClientRect();
      if (rect)
        setPosition((current) => ({
          x: Math.max(8, Math.min(current.x, window.innerWidth - rect.width - 8)),
          y: Math.max(8, Math.min(current.y, window.innerHeight - rect.height - 8)),
        }));
    }
    window.addEventListener('resize', resize);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize);
    if (frame.current) observer?.observe(frame.current);
    return () => {
      window.removeEventListener('resize', resize);
      observer?.disconnect();
    };
  }, []);
  useEffect(() => {
    function unload(event: BeforeUnloadEvent) {
      if (busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [busy]);
  return (
    <div
      ref={frame}
      role="dialog"
      aria-modal="false"
      aria-labelledby={title}
      className="token-actions-window"
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="token-actions-header">
        <div
          tabIndex={0}
          className="token-actions-handle"
          aria-label="Move quick actions window"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const rect = frame.current!.getBoundingClientRect();
            drag.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current)
              move(
                drag.current.left + e.clientX - drag.current.x,
                drag.current.top + e.clientY - drag.current.y,
              );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(e) => {
            const delta = {
              ArrowLeft: [-20, 0],
              ArrowRight: [20, 0],
              ArrowUp: [0, -20],
              ArrowDown: [0, 20],
            }[e.key];
            if (delta) {
              e.preventDefault();
              move(position.x + delta[0], position.y + delta[1]);
            }
          }}
        >
          <span className="eyebrow">QUICK ACTIONS</span>
          <h2 id={title}>{token.label} quick actions</h2>
        </div>
        <button aria-label="Close quick actions" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="token-actions-body stack">
        {blocked && <p role="status">Save or reload sheet edits before using quick actions.</p>}
        {snapshot.role === 'gm' && (
          <details>
            <summary>GM token controls</summary>
            <button disabled={locked} onClick={() => void updateToken({ hidden: !token.hidden })}>
              {token.hidden ? 'Reveal token' : 'Hide token'}
            </button>
            <label>
              Assign control
              <select
                aria-label="Assign token control"
                value={token.controller_id}
                disabled={locked}
                onChange={(e) => void updateToken({ controller_id: e.target.value })}
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
                aria-label="Token size"
                type="number"
                min={16}
                max={256}
                key={`${token.id}:${token.size}`}
                defaultValue={token.size}
                disabled={locked}
                onBlur={(e) => {
                  const size = Number(e.target.value);
                  if (Number.isInteger(size) && size >= 16 && size <= 256 && size !== token.size)
                    void updateToken({ size });
                }}
              />
            </label>
            <p className="small">
              Control permits movement and rolls with sheet access, not sheet editing. Visibility,
              control and size are not undoable.
            </p>
            <p role="status">{actionMessage}</p>
          </details>
        )}
        {snapshot.role === 'gm' ? (
          <TokenInitiative
            token={token}
            actor={actor}
            snapshot={snapshot}
            disabled={
              blocked ||
              resourceBusy ||
              combatBusy ||
              assistanceBusy ||
              duplicateBusy ||
              actionBusy ||
              rollPending
            }
            run={run}
            refresh={refresh}
            onBusyChange={setInitiativeBusy}
          />
        ) : (
          <p className="small">
            Initiative: ask the GM to add or update this token in the encounter.
          </p>
        )}
        {actor ? (
          <>
            <button onClick={onSheet}>Open character sheet</button>
            {ac !== undefined && <span>Armor Class: {ac}</span>}
            <details>
              <summary>Attack / sheet rolls</summary>
              {onVisibilityChange && (
                <label>
                  Roll visibility
                  <select
                    value={visibility}
                    onChange={(e) => onVisibilityChange(e.target.value as 'public' | 'private')}
                  >
                    <option value="public">Everyone</option>
                    <option value="private">
                      {snapshot.role === 'gm' ? 'Only me' : 'Me and GM'}
                    </option>
                  </select>
                </label>
              )}
              <p className="small">
                Roll audience:{' '}
                {visibility === 'private'
                  ? snapshot.role === 'gm'
                    ? 'Private · only you'
                    : 'Private · you and GM'
                  : 'Public · everyone'}
                . Targeting, hits and resource use remain manual.
              </p>
              {!rollable && (
                <p>
                  Only the GM, owner or a token controller can roll. Sheet viewing/editing alone
                  does not grant control.
                </p>
              )}
              {rolls.length ? (
                <>
                  <label>
                    Saved action
                    <select
                      aria-label="Token attack or ability"
                      value={selectedRoll?.id}
                      onChange={(e) => setChosenRoll(e.target.value)}
                    >
                      {rolls.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    d20 mode
                    <select
                      aria-label="Token d20 roll mode"
                      value={mode}
                      onChange={(e) => setMode(e.target.value)}
                    >
                      <option value="normal">Normal</option>
                      <option value="advantage">Advantage</option>
                      <option value="disadvantage">Disadvantage</option>
                    </select>
                  </label>
                  {selectedRoll?.description && (
                    <details>
                      <summary>Action rules</summary>
                      <p>{selectedRoll.description}</p>
                    </details>
                  )}
                  <button
                    disabled={!rollable || locked || !onRoll}
                    onClick={() => {
                      if (!selectedRoll || !selectedExpression) return;
                      void onRoll?.({
                        actorId: actor.id,
                        rollType: selectedRoll.name,
                        expression: selectedExpression,
                      });
                    }}
                  >
                    Roll selected action
                  </button>
                  <button
                    disabled={!rollable || locked || !onAdvancedRoll}
                    onClick={() => {
                      if (selectedRoll && selectedExpression)
                        onAdvancedRoll?.({
                          actorId: actor.id,
                          expression: selectedExpression,
                          rollType: selectedRoll.name,
                        });
                    }}
                  >
                    Advanced roll in Dice
                  </button>
                </>
              ) : (
                <p>
                  No saved attack or roll. Configure one on the sheet, or use Dice for an advanced
                  expression.
                </p>
              )}
            </details>
            {snapshot.role === 'gm' && actor.kind === 'character' && (
              <p className="small">
                Duplicate is available for NPC/enemy creatures only. Player characters keep shared
                state across placements.
              </p>
            )}
            {snapshot.role === 'gm' && actor.kind !== 'character' && (
              <details>
                <summary>Duplicate as independent creature</summary>
                <p className="small">
                  {actor.encounter_instance
                    ? 'Independent encounter creature.'
                    : 'Definition / legacy linked actor.'}{' '}
                  Copies current sheet state, not sheet grants. Existing tokens remain unchanged.
                </p>
                <CreatureAdder
                  key={`${token.scene_id}:${actor.id}`}
                  gameId={snapshot.game.id}
                  sceneId={token.scene_id}
                  source={{ kind: 'actor', actor_id: actor.id, revision: actor.revision }}
                  disabled={
                    blocked ||
                    resourceBusy ||
                    combatBusy ||
                    assistanceBusy ||
                    initiativeBusy ||
                    actionBusy ||
                    rollPending
                  }
                  onBusyChange={setDuplicateBusy}
                  run={run}
                  label="Duplicate as independent creature"
                />
              </details>
            )}
            {!editable && (
              <p className="small">Read only. Token control does not grant sheet editing.</p>
            )}
            <QuickResources
              key={actor.id}
              actor={actor}
              editable={editable}
              blocked={
                blocked ||
                combatBusy ||
                assistanceBusy ||
                initiativeBusy ||
                duplicateBusy ||
                actionBusy
              }
              run={run}
              onBusyChange={setResourceBusy}
              onCommitted={onCommitted}
            />
            <CombatControls
              key={`combat:${actor.id}`}
              actor={actor}
              snapshot={snapshot}
              editable={editable}
              blocked={
                blocked ||
                resourceBusy ||
                assistanceBusy ||
                initiativeBusy ||
                duplicateBusy ||
                actionBusy
              }
              run={run}
              onBusyChange={setCombatBusy}
              onRoll={onRoll}
            />
            {editable && (
              <PlayAssistance
                key={`assistance:${snapshot.userId}:${actor.id}`}
                actor={actor}
                token={token}
                userId={snapshot.userId}
                disabled={locked}
                active={token.scene_id === snapshot.game.active_scene_id}
                run={run}
                onBusyChange={setAssistanceBusy}
              />
            )}
            {!actor.sheet.sections.some((s) => s.fields.some((f) => f.kind === 'resource')) &&
              !actor.sheet.character?.features.some((f) => f.maxUses > 0) && (
                <p className="small">
                  No resources configured. Add counters in the character sheet.
                </p>
              )}
          </>
        ) : (
          <p>No sheet access. Ask the GM for access to use this token’s resources.</p>
        )}
      </div>
    </div>
  );
}

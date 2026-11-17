'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { mutate, roll, uploadAsset } from '@/app/actions';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { Command } from '@/lib/commands';
import type { Snapshot } from '@/lib/types';
import { emptySheet } from '@/lib/sheets';
import { createDndSheet } from '@/lib/dnd';
import { defaultDiceStyle } from '@/lib/dice-style';
import { selectedDiceSides } from '@/lib/dice-selection';
import { presentCue, type Presentation } from '@/lib/dice-presentation';
import { DiceStyleEditor } from './dice-style-editor';
import { SheetWindow } from './sheet-window';
import { RollWindow } from './roll-window';
import { ActorCard } from './actor-card';
import { RoomShortcuts } from './room-shortcuts';
import { useDiceZoom } from './use-dice-zoom';
import { TokenQuickActions } from './token-quick-actions';
import { useTabletopEdits } from './use-tabletop-edits';
import { monsterId } from '@/lib/monster-sheet';
import { EncounterPanel, EncounterTurnCue } from './encounter-panel';

const Tabletop = dynamic(() => import('./tabletop'), {
  ssr: false,
  loading: () => <div className="canvas-empty">Loading tabletop…</div>,
});
const DiceOverlay = dynamic(() => import('./dice-overlay'), { ssr: false });
const MonsterLibrary = dynamic(() => import('./monster-library'));
type Tab = 'party' | 'encounter' | 'dice' | 'scenes' | 'settings' | 'appearance';

export function Room({ initial }: { initial: Snapshot }) {
  const [diceZoom, setDiceZoom] = useDiceZoom();
  const [snapshot, setSnapshot] = useState(initial);
  const [tab, setTab] = useState<Tab>('party');
  const [selectedActor, setSelectedActor] = useState<string>();
  const [initialBuilderActor, setInitialBuilderActor] = useState<string>();
  const sheetDirtyRef = useRef(false);
  const [sheetDirty, setSheetDirty] = useState(false);
  const trackSheetDirty = useCallback((dirty: boolean) => {
    sheetDirtyRef.current = dirty;
    setSheetDirty(dirty);
  }, []);
  const [quickActions, setQuickActions] = useState<{
    tokenId: string;
    anchor: { x: number; y: number };
  }>();
  const [quickBusy, setQuickBusy] = useState(false);
  const [error, setError] = useState('');
  const [sync, setSync] = useState('Connecting');
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState(false);
  const [invite, setInvite] = useState('');
  const [expression, setExpression] = useState('1d20');
  const [rollType, setRollType] = useState('Manual roll');
  const [diceDetached, setDiceDetached] = useState(false);
  const [rollActor, setRollActor] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [diceSetting, setDiceSetting] = useState(initial.game.dice.join(', '));
  const [createActor, setCreateActor] = useState(false);
  const [modifier, setModifier] = useState('0');
  const [animations, setAnimations] = useState<Presentation[]>([]);
  const seenCues = useRef(new Set(initial.rollCues?.map((c) => c.roll_id) ?? []));
  const clearAnimation = useCallback(() => setAnimations((queue) => queue.slice(1)), []);
  const rollAttempt = useRef<{ key: string; id: string } | null>(null);
  const rollPending = useRef(false);
  const refreshRunning = useRef(false);
  const refreshAgain = useRef(false);
  const gm = snapshot.role === 'gm';
  const selectedDice = selectedDiceSides(expression);
  const scene = snapshot.scenes.find((s) => s.id === snapshot.game.active_scene_id);
  const tabletopEdits = useTabletopEdits(
    `${snapshot.userId}:${snapshot.game.id}:${scene?.id ?? 'none'}`,
    scene?.id,
    run,
  );
  const actor = snapshot.actors.find((a) => a.id === selectedActor);
  const quickToken = snapshot.tokens.find(
    (t) => t.id === quickActions?.tokenId && t.scene_id === snapshot.game.active_scene_id,
  );
  const quickActor = snapshot.actors.find((a) => a.id === quickToken?.actor_id);
  function leaveQuickActions() {
    return (
      !quickBusy ||
      window.confirm(
        'A resource update is saving or unconfirmed. Close anyway? This does not cancel or reverse it; reopen the token to check the latest values.',
      )
    );
  }
  function openSheet(id: string, startBuilder = false) {
    if (
      id !== selectedActor &&
      sheetDirtyRef.current &&
      !window.confirm('Discard unsaved character sheet changes and open another sheet?')
    )
      return false;
    if (
      gm &&
      id !== selectedActor &&
      monsterId(snapshot.actors.find((a) => a.id === id)?.sheet ?? emptySheet())
    )
      setVisibility('private');
    setSelectedActor(id);
    setInitialBuilderActor(startBuilder ? id : undefined);
    return true;
  }
  const controlledActors = snapshot.actors.filter(
    (a) =>
      gm ||
      a.owner_id === snapshot.userId ||
      snapshot.tokens.some((t) => t.actor_id === a.id && t.controller_id === snapshot.userId),
  );
  const refresh = useCallback(async () => {
    if (refreshRunning.current) {
      refreshAgain.current = true;
      return;
    }
    refreshRunning.current = true;
    try {
      do {
        refreshAgain.current = false;
        const response = await fetch(`/api/games/${initial.game.id}`, { cache: 'no-store' });
        if (response.status === 403) {
          setDenied(true);
          return;
        }
        if (!response.ok) throw new Error('Sync failed');
        const updated: Snapshot = await response.json();
        const fresh = (updated.rollCues ?? [])
          .filter(
            (c) =>
              !seenCues.current.has(c.roll_id) &&
              Date.now() - new Date(c.created_at).getTime() < 15000,
          )
          .reverse();
        const next: Presentation[] = [];
        for (const cue of fresh) {
          const presentation = presentCue(cue, updated.rolls);
          if (!presentation) continue;
          seenCues.current.add(cue.roll_id);
          next.push(presentation);
        }
        if (next.length) setAnimations((queue) => [...queue, ...next].slice(-4));
        setSnapshot(updated);
        setQuickActions((current) =>
          updated.tokens.some(
            (t) => t.id === current?.tokenId && t.scene_id === updated.game.active_scene_id,
          )
            ? current
            : undefined,
        );
        setSelectedActor((current) =>
          updated.actors.some((a) => a.id === current) ? current : undefined,
        );
        setRollActor((current) =>
          updated.actors.some(
            (a) =>
              a.id === current &&
              (updated.role === 'gm' ||
                a.owner_id === updated.userId ||
                updated.tokens.some(
                  (t) => t.actor_id === a.id && t.controller_id === updated.userId,
                )),
          )
            ? current
            : '',
        );
        setSync('Connected');
      } while (refreshAgain.current);
    } catch {
      setSync('Reconnecting…');
    } finally {
      refreshRunning.current = false;
    }
  }, [initial.game.id]);
  useEffect(() => {
    const db = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout>;
    const queue = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 120);
    };
    const channel = db
      .channel(`room:${initial.game.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_events',
          filter: `game_id=eq.${initial.game.id}`,
        },
        queue,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'roll_cues',
          filter: `game_id=eq.${initial.game.id}`,
        },
        queue,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void refresh();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')
          setSync('Reconnecting…');
      });
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    const foreground = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('online', foreground);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('online', foreground);
      document.removeEventListener('visibilitychange', foreground);
      void db.removeChannel(channel);
    };
  }, [initial.game.id, refresh]);
  async function run(command: Command, payload: unknown) {
    setError('');
    try {
      const result = await mutate(snapshot.game.id, command, payload);
      if (result.error) {
        setError(result.error);
        await refresh();
        return;
      }
      await refresh();
      return result.data;
    } catch {
      setError('Connection lost. Your change was not confirmed. Reload before retrying.');
    }
  }
  async function sendRoll(sheetRoll?: { actorId: string; expression: string; rollType: string }) {
    if (rollPending.current) return;
    rollPending.current = true;
    setPending(true);
    setError('');
    const actorId = sheetRoll?.actorId ?? rollActor;
    const finalExpression = sheetRoll
      ? sheetRoll.expression
      : Number(modifier)
        ? `(${expression}) + (${Number(modifier)})`
        : expression;
    const type = (sheetRoll?.rollType ?? rollType).slice(0, 160);
    const key = JSON.stringify([finalExpression, actorId, visibility, type]);
    if (rollAttempt.current?.key !== key) rollAttempt.current = { key, id: crypto.randomUUID() };
    try {
      const result = await roll(snapshot.game.id, {
        id: rollAttempt.current.id,
        actor_id: actorId || null,
        expression: finalExpression,
        visibility,
        roll_type: type,
      });
      if (result.error) {
        setError(result.error);
        rollAttempt.current = null;
      } else {
        if (gm && visibility === 'private' && result.result) {
          const presentation = presentCue(
            {
              roll_id: rollAttempt.current.id,
              private: true,
              created_at: new Date().toISOString(),
            },
            [
              {
                id: rollAttempt.current.id,
                author_id: snapshot.userId,
                result: result.result,
              } as Snapshot['rolls'][number],
            ],
          );
          if (presentation) setAnimations((queue) => [...queue, presentation].slice(-4));
        }
        rollAttempt.current = null;
        await refresh();
      }
    } catch {
      setError('Roll not confirmed. Retry without changing it to avoid a duplicate.');
    } finally {
      rollPending.current = false;
      setPending(false);
    }
  }
  function rollFromSheet(actorId: string, value: string, type = 'Manual roll') {
    setRollActor(actorId);
    setExpression(value);
    setModifier('0');
    setRollType(type);
    void sendRoll({ actorId, expression: value, rollType: type });
  }
  async function imageUpload(file: File, kind: 'background' | 'token') {
    const form = new FormData();
    form.set('game_id', snapshot.game.id);
    form.set('kind', kind);
    form.set('file', file);
    const result = await uploadAsset(form);
    if (result.error) throw new Error(result.error);
    return result.id!;
  }
  if (denied)
    return (
      <main className="setup">
        <h1>Room access ended.</h1>
        <Link href="/">Return to your games</Link>
      </main>
    );
  return (
    <main className="room">
      <header className="room-header">
        <Link href="/" className="brand" title="Back to games">
          ◈ Not Another Simple Vtt
        </Link>
        <span className="header-divider" />
        <div>
          <strong>{snapshot.game.name}</strong>
          <span className="small muted">
            {gm ? 'Game Master' : 'Player'} · {snapshot.members.length} adventurers
          </span>
        </div>
        <span className={`connection ${sync === 'Connected' ? 'connected' : ''}`} role="status">
          ● {sync}
        </span>
        <Link className="button ghost" href="/">
          Leave table ↗
        </Link>
      </header>
      <RoomShortcuts
        actors={snapshot.actors}
        userId={snapshot.userId}
        gm={gm}
        visibility={visibility}
        onVisibilityChange={setVisibility}
        onParty={() => setTab('party')}
        onOpen={(id) => {
          openSheet(id);
        }}
      />
      <EncounterTurnCue snapshot={snapshot} />
      <div className="room-body">
        <Tabletop
          key={scene?.id ?? 'empty'}
          snapshot={snapshot}
          edits={tabletopEdits}
          run={run}
          openQuickActions={(tokenId, anchor) => {
            if (quickActions?.tokenId !== tokenId && !leaveQuickActions()) return;
            setQuickActions({ tokenId, anchor });
          }}
          selectActor={(id) => {
            if (snapshot.actors.some((a) => a.id === id)) {
              if (openSheet(id)) setTab('party');
            }
          }}
        />
        {quickToken && quickActions && (
          <TokenQuickActions
            key={quickToken.id}
            token={quickToken}
            actor={quickActor}
            snapshot={snapshot}
            anchor={quickActions.anchor}
            blocked={selectedActor === quickActor?.id && sheetDirty}
            busy={quickBusy}
            run={run}
            onBusyChange={setQuickBusy}
            onRoll={sendRoll}
            onClose={() => {
              if (leaveQuickActions()) {
                setQuickActions(undefined);
                setQuickBusy(false);
              }
            }}
            onSheet={() => {
              if (quickActor) openSheet(quickActor.id);
            }}
            onCommitted={(sheet, revision, name) => {
              setSnapshot((current) => ({
                ...current,
                actors: current.actors.map((a) =>
                  a.id === quickActor?.id && revision >= a.revision
                    ? { ...a, sheet, revision, ...(name !== undefined ? { name } : {}) }
                    : a,
                ),
              }));
            }}
          />
        )}
        {animations[0] && (
          <DiceOverlay
            key={animations[0].id}
            presentation={animations[0]}
            onDone={clearAnimation}
            style={
              animations[0].masked
                ? defaultDiceStyle
                : (snapshot.diceStyles?.find((s) => s.user_id === animations[0].authorId)?.style ??
                  defaultDiceStyle)
            }
          />
        )}
        <aside className="sidebar">
          <nav className="tabs" aria-label="Room panels">
            {(
              [
                'party',
                'encounter',
                'dice',
                ...(gm ? ['scenes'] : []),
                'appearance',
                'settings',
              ] as Tab[]
            ).map((t) => (
              <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t === 'settings'
                  ? 'Room'
                  : t === 'appearance'
                    ? 'Style'
                    : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          <div className="panel">
            {tab === 'encounter' && (
              <EncounterPanel
                key={`${snapshot.userId}:${snapshot.game.id}:${scene?.id ?? 'none'}`}
                snapshot={snapshot}
                run={run}
                refresh={refresh}
                onSheet={(id) => {
                  openSheet(id);
                }}
              />
            )}
            {tab === 'appearance' && (
              <DiceStyleEditor
                initial={
                  snapshot.diceStyles?.find((s) => s.user_id === snapshot.userId)?.style ??
                  defaultDiceStyle
                }
                onSaved={refresh}
              />
            )}
            {tab === 'party' && (
              <>
                <>
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">THE ADVENTURERS</span>
                      <h2>At the table</h2>
                    </div>
                    <button
                      onClick={() => setCreateActor(!createActor)}
                      aria-label="Create character"
                    >
                      +
                    </button>
                  </div>
                  <p className="muted small">
                    Click a character to open their sheet. Or focus a card and press Enter.
                  </p>
                  {gm && (
                    <details>
                      <summary>SRD monsters · Add independent creatures</summary>
                      <MonsterLibrary snapshot={snapshot} run={run} />
                    </details>
                  )}
                  {createActor && (
                    <form
                      className="card stack"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setPending(true);
                        const form = new FormData(e.currentTarget);
                        const template = snapshot.templates.find(
                          (t) => t.id === form.get('template'),
                        );
                        const data = await run('actor_create', {
                          name: form.get('name'),
                          kind: form.get('kind') || 'character',
                          owner_id: form.get('owner_id') || snapshot.userId,
                          sheet:
                            form.get('template') === 'srd-5.2.1'
                              ? createDndSheet()
                              : template?.sheet || emptySheet(),
                        });
                        if (data?.id) {
                          openSheet(data.id, form.get('template') === 'srd-5.2.1');
                          setCreateActor(false);
                        }
                        setPending(false);
                      }}
                    >
                      <label>
                        Name
                        <input name="name" required maxLength={100} placeholder="A new hero…" />
                      </label>
                      {gm && (
                        <>
                          <label>
                            Actor type
                            <select name="kind">
                              <option value="character">Player character</option>
                              <option value="npc">NPC</option>
                              <option value="enemy">Enemy</option>
                            </select>
                          </label>
                          <label>
                            Owner
                            <select name="owner_id" defaultValue={snapshot.userId}>
                              {snapshot.members.map((m) => (
                                <option key={m.user_id} value={m.user_id}>
                                  {m.display_name}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      )}
                      <label>
                        Start from template
                        <select name="template">
                          <option value="">Blank sheet</option>
                          <option value="srd-5.2.1">5.5e · SRD 5.2.1</option>
                          {snapshot.templates.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="primary" disabled={pending}>
                        Create actor
                      </button>
                    </form>
                  )}
                  <div className="actor-list">
                    {snapshot.actors.map((a) => (
                      <ActorCard
                        key={a.id}
                        actor={a}
                        ownerName={
                          snapshot.members.find((m) => m.user_id === a.owner_id)?.display_name
                        }
                        onOpen={() => openSheet(a.id)}
                      />
                    ))}
                  </div>
                  {snapshot.actors.length === 0 && (
                    <div className="empty">
                      <span>♧</span>
                      <h3>Your party starts here.</h3>
                      <p>Create your first character sheet.</p>
                    </div>
                  )}
                  {scene && (
                    <details>
                      <summary>Add character token to scene</summary>
                      <form
                        className="stack"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          setPending(true);
                          setError('');
                          const form = new FormData(e.currentTarget);
                          try {
                            await run('token_create', {
                              actor_id: form.get('actor_id'),
                              scene_id: scene.id,
                            });
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Upload failed.');
                          } finally {
                            setPending(false);
                          }
                        }}
                      >
                        <label>
                          Actor
                          <select name="actor_id" aria-label="Actor" required>
                            <option value="">Choose character…</option>
                            {snapshot.actors
                              .filter((a) => gm || a.owner_id === snapshot.userId)
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <p className="small muted">
                          Uses the portrait and ring saved on the character sheet.
                        </p>
                        {gm && (
                          <p className="small">
                            This places a linked token: all tokens of this actor share its sheet, HP
                            and resources. Use SRD monsters or Duplicate as independent creature for
                            separate enemies. Player character state stays shared across scenes.
                          </p>
                        )}
                        <button disabled={pending}>Place token</button>
                        <p className="small muted">
                          New tokens start near the map’s top-left. The GM may need to reveal that
                          area.
                        </p>
                      </form>
                    </details>
                  )}
                </>
              </>
            )}
            {tab === 'dice' && diceDetached && (
              <p className="muted">
                Rolls are open in a separate VTT window.{' '}
                <button onClick={() => setDiceDetached(false)}>Dock rolls</button>
              </p>
            )}
            {(tab === 'dice' || diceDetached) && (
              <RollWindow
                detached={diceDetached}
                onDock={() => {
                  setDiceDetached(false);
                  setTab('dice');
                }}
              >
                <div className="stack">
                  {diceDetached && error && (
                    <p className="error-banner" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">LET FATE DECIDE</span>
                      <h2>Roll the dice</h2>
                    </div>
                    {!diceDetached && (
                      <button
                        onClick={() => setDiceDetached(true)}
                        aria-label="Pop out roll window"
                      >
                        ↗
                      </button>
                    )}
                  </div>
                  <div className="dice-types">
                    {snapshot.game.dice.map((d) => (
                      <button
                        key={d}
                        aria-pressed={selectedDice.has(d)}
                        onClick={() => setExpression(`1d${d}`)}
                      >
                        d{d}
                      </button>
                    ))}
                  </div>
                  <label>
                    Dice zoom: {Math.round(diceZoom * 100)}%
                    <input
                      type="range"
                      min={1}
                      max={2}
                      step={0.05}
                      value={diceZoom}
                      onChange={(e) => setDiceZoom(Number(e.target.value))}
                    />
                    <span className="small muted">Your view only · 100%–200%</span>
                  </label>
                  <label>
                    Roll for
                    <select value={rollActor} onChange={(e) => setRollActor(e.target.value)}>
                      <option value="">Me · manual roll</option>
                      {controlledActors.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Roll type
                    <input
                      value={rollType}
                      maxLength={160}
                      onChange={(e) => setRollType(e.target.value)}
                      placeholder="Athletics check, attack with Longsword…"
                    />
                  </label>
                  <label>
                    Expression
                    <input
                      value={expression}
                      maxLength={500}
                      onChange={(e) => setExpression(e.target.value)}
                      placeholder="2d6 + 3"
                    />
                  </label>
                  <div className="row">
                    <button
                      disabled={!snapshot.game.dice.includes(20)}
                      onClick={() => setExpression('2d20kh1')}
                    >
                      Advantage
                    </button>
                    <button
                      disabled={!snapshot.game.dice.includes(20)}
                      onClick={() => setExpression('2d20kl1')}
                    >
                      Disadvantage
                    </button>
                  </div>
                  {rollActor && (
                    <label>
                      Sheet modifier
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) setExpression((v) => `${v} + @{${e.target.value}}`);
                        }}
                      >
                        <option value="">Insert numeric field…</option>
                        {snapshot.actors
                          .find((a) => a.id === rollActor)
                          ?.sheet.sections.flatMap((s) => s.fields)
                          .filter((f) => f.kind !== 'text')
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.label} ({f.value})
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <div className="two-cols">
                    <label>
                      Extra modifier
                      <input
                        type="number"
                        value={modifier}
                        onChange={(e) => setModifier(e.target.value)}
                      />
                    </label>
                    <label>
                      Visibility
                      <select
                        value={visibility}
                        onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                      >
                        <option value="public">Everyone</option>
                        <option value="private">{gm ? 'Only me' : 'Me and GM'}</option>
                      </select>
                    </label>
                  </div>
                  <button
                    className="primary roll-button"
                    disabled={pending || !expression || !rollType.trim()}
                    onClick={() => void sendRoll()}
                  >
                    {pending ? 'Rolling…' : '◇ Roll dice'}
                  </button>
                  <details>
                    <summary>Expression guide</summary>
                    <p className="small muted">
                      Use + − * / and parentheses. Try (2d6 + 3) / 2. Keep highest: 4d6kh3; lowest:
                      2d20kl1. Up to 100 dice per roll. Division keeps decimals. Sheet fields use
                      stable references inserted above.
                    </p>
                  </details>
                  <div className="section-divider">
                    <span>RECENT ROLLS</span>
                    <span>LAST 50</span>
                  </div>
                  {snapshot.rolls.map((r) => (
                    <article className="roll-card" key={r.id}>
                      <div className="row">
                        <strong>{r.actor_name || r.author_name}</strong>
                        <span className="small muted">
                          {r.visibility === 'private'
                            ? '🔒 Private'
                            : new Date(r.created_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                        </span>
                      </div>
                      <div className="small">
                        {r.roll_type || 'Manual roll'}
                        {r.actor_name && <span className="muted"> · {r.author_name}</span>}
                      </div>
                      <div className="roll-result">
                        <code>{r.result.resolvedExpression}</code>
                        <strong>{Number(r.result.total.toFixed(4))}</strong>
                      </div>
                      <div className="wrap">
                        {r.result.dice.map((d, i) => (
                          <span className="small muted" key={i}>
                            d{d.sides} [
                            {d.values.map((value, j) => (
                              <span key={j} className={d.kept[j] ? '' : 'discarded'}>
                                {j > 0 ? ', ' : ''}
                                {value}
                              </span>
                            ))}
                            ]
                          </span>
                        ))}
                      </div>
                    </article>
                  ))}
                  {snapshot.rolls.length === 0 && (
                    <p className="muted small">Your story’s first roll is still to come.</p>
                  )}
                </div>
              </RollWindow>
            )}
            {tab === 'scenes' && gm && (
              <div className="stack">
                <span className="eyebrow">SET THE STAGE</span>
                <h2>Your scenes</h2>
                {snapshot.scenes.map((s) => (
                  <article key={s.id} className="scene-card">
                    <div>
                      <strong>{s.name}</strong>
                      <small>
                        {s.width} × {s.height} · {s.unit}
                      </small>
                    </div>
                    <button
                      disabled={s.id === scene?.id}
                      onClick={() => run('scene_activate', { id: s.id })}
                    >
                      {s.id === scene?.id ? 'Active' : 'Activate'}
                    </button>
                  </article>
                ))}
                <form
                  className="card stack"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    const element = e.currentTarget;
                    setPending(true);
                    setError('');
                    try {
                      const assetId = await imageUpload(form.get('image') as File, 'background');
                      const data = await run('scene_create', {
                        name: form.get('name'),
                        asset_id: assetId,
                      });
                      if (data) element.reset();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Upload failed.');
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  <h3>Upload a scene</h3>
                  <label>
                    Scene name
                    <input name="name" required maxLength={100} placeholder="The quiet clearing" />
                  </label>
                  <label>
                    Background image
                    <input
                      name="image"
                      required
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                    />
                  </label>
                  <p className="small muted">
                    PNG, JPEG, WebP · up to 4 MB / 4096 px.
                    <br />
                    New scenes start fully concealed.
                  </p>
                  <button className="primary" disabled={pending}>
                    {pending ? 'Uploading…' : 'Create scene'}
                  </button>
                </form>
                {scene && (
                  <div className="card stack">
                    <h3>Fog of war</h3>
                    <p className="small muted">
                      Use Reveal and Conceal on the map to draw areas. Player view previews the
                      current fog.
                    </p>
                    <button
                      disabled={tabletopEdits.blocked}
                      onClick={() =>
                        tabletopEdits.commit('tabletop_fog', {
                          id: scene.id,
                          revision: scene.revision,
                          fog: [
                            { x: 0, y: 0, width: scene.width, height: scene.height, reveal: true },
                          ],
                        })
                      }
                    >
                      Reveal entire scene
                    </button>
                    <button
                      disabled={tabletopEdits.blocked}
                      onClick={() =>
                        tabletopEdits.commit('tabletop_fog', {
                          id: scene.id,
                          revision: scene.revision,
                          fog: [],
                        })
                      }
                    >
                      Conceal entire scene
                    </button>
                  </div>
                )}
              </div>
            )}
            {tab === 'settings' && (
              <div className="stack">
                <span className="eyebrow">YOUR SHARED SPACE</span>
                <h2>Room details</h2>
                <h3>The party</h3>
                {snapshot.members.map((m) => (
                  <div className="row member" key={m.user_id}>
                    <span>
                      {m.display_name}
                      {m.user_id === snapshot.userId ? ' (you)' : ''}
                    </span>
                    <span className="badge">{m.role === 'gm' ? 'GM' : 'Player'}</span>
                  </div>
                ))}
                {gm && (
                  <>
                    <div className="section-divider">INVITATIONS</div>
                    <button
                      onClick={async () => {
                        const data = await run('invite', {});
                        if (data?.url) setInvite(data.url);
                      }}
                    >
                      Create invitation link
                    </button>
                    {invite && (
                      <label>
                        Valid for 7 days
                        <input readOnly value={invite} onFocus={(e) => e.target.select()} />
                        <button
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(invite);
                            } catch {
                              setError('Select the link and copy it manually.');
                            }
                          }}
                        >
                          Copy link
                        </button>
                      </label>
                    )}
                    <button
                      onClick={async () => {
                        const data = await run('revoke_invites', {});
                        if (data) setInvite('');
                      }}
                    >
                      Revoke all invitation links
                    </button>
                    <div className="section-divider">GAME DICE</div>
                    <label>
                      Allowed die sizes
                      <input
                        value={diceSetting}
                        onChange={(e) => setDiceSetting(e.target.value)}
                        placeholder="4, 6, 8, 10, 12, 20, 100"
                      />
                    </label>
                    <button
                      onClick={() =>
                        run('dice', { dice: diceSetting.split(',').map((v) => Number(v.trim())) })
                      }
                    >
                      Save dice
                    </button>
                  </>
                )}
                <div className="section-divider">SHEET TEMPLATES</div>
                {snapshot.templates.map((t) => (
                  <div key={t.id} className="card">
                    <strong>{t.name}</strong>
                    {t.creator_id === snapshot.userId && (
                      <form
                        className="stack"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const form = new FormData(e.currentTarget);
                          const destination = String(form.get('destination'));
                          setError('');
                          try {
                            const result = await mutate(destination, 'template_copy', { id: t.id });
                            if (result.error) setError(result.error);
                            else await refresh();
                          } catch {
                            setError('Copy failed. Please retry.');
                          }
                        }}
                      >
                        <label>
                          Copy to another game ID
                          <input name="destination" placeholder="Game ID from its URL" required />
                        </label>
                        <button>Copy template</button>
                      </form>
                    )}
                  </div>
                ))}
                {snapshot.templates.length === 0 && (
                  <p className="small muted">Save a sheet as a template from its editor.</p>
                )}
                <p className="small muted">
                  Game ID: <code>{snapshot.game.id}</code>
                </p>
              </div>
            )}
          </div>
          <footer className="sidebar-footer">YOUR WORLD. YOUR RULES.</footer>
        </aside>
      </div>
      {actor && (
        <SheetWindow
          externalBusy={!!quickActor && selectedActor === quickActor.id && quickBusy}
          key={actor.id}
          actor={actor}
          snapshot={snapshot}
          run={run}
          onRoll={rollFromSheet}
          onClose={() => setSelectedActor(undefined)}
          error={error}
          onDirtyChange={trackSheetDirty}
          initialBuilderOpen={initialBuilderActor === actor.id}
        />
      )}
    </main>
  );
}

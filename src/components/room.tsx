'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { mutate, roll, uploadAsset } from '@/app/actions';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { Command } from '@/lib/commands';
import type { Snapshot } from '@/lib/types';
import { emptySheet } from '@/lib/sheets';
import { defaultDiceStyle } from '@/lib/dice-style';
import { diceSelection } from '@/lib/dice-selection';
import { presentCue, type Presentation } from '@/lib/dice-presentation';
import { DiceStyleEditor } from './dice-style-editor';
import { SheetWindow } from './sheet-window';
import { RollWindow } from './roll-window';
import { loadLayout, type WindowLayout } from '@/lib/window-layout';
import { ActorCard } from './actor-card';
import { RoomShortcuts } from './room-shortcuts';
import { useDiceZoom } from './use-dice-zoom';
import { TokenQuickActions } from './token-quick-actions';
import { useTabletopEdits } from './use-tabletop-edits';
import { monsterId } from '@/lib/monster-sheet';
import { EncounterPanel, EncounterTurnCue } from './encounter-panel';
import { TableTokenList } from './table-token-list';
import { PracticeTable } from './practice-table';
import { tableSystem } from '@/lib/table-system';
import { useRoomAttention } from './use-room-attention';

const Tabletop = dynamic(() => import('./tabletop'), {
  ssr: false,
  loading: () => <div className="canvas-empty">Loading tabletop…</div>,
});
const DiceOverlay = dynamic(() => import('./dice-overlay'), { ssr: false });
const MonsterLibrary = dynamic(() => import('./monster-library'));
type Tab = 'party' | 'encounter' | 'dice' | 'scenes' | 'settings' | 'appearance';

export function Room({ initial }: { initial: Snapshot }) {
  const storageKey = `vtt:layout:v1:${initial.userId}:${initial.game.id}`;
  return <RoomWorkspace key={storageKey} initial={initial} storageKey={storageKey} />;
}

function RoomWorkspace({ initial, storageKey }: { initial: Snapshot; storageKey: string }) {
  const [diceZoom, setDiceZoom] = useDiceZoom();
  const [snapshot, setSnapshot] = useState(initial);
  const prepare = useRef<string | undefined>(undefined);
  const [bringParty, setBringParty] = useState(false);
  const [tab, setTab] = useState<Tab>('party');
  const [layout, setLayout] = useState<WindowLayout>({ detached: false });
  const [loaded, setLoaded] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [firstSnapshot] = useState(initial);
  const selectedActor = layout.actor;
  const diceDetached = layout.detached;
  const changeLayout = useCallback(
    (patch: Partial<WindowLayout>) => setLayout((current) => ({ ...current, ...patch })),
    [],
  );
  const setDiceDetached = (detached: boolean) => changeLayout({ detached });
  useEffect(() => {
    const restored = loadLayout(storageKey);
    const actor = firstSnapshot.actors.find((a) => a.id === restored.actor);
    // Reading browser storage after hydration keeps the initial server and client markup identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayout({ ...restored, actor: actor?.id });
    if (firstSnapshot.role === 'gm' && actor && monsterId(actor.sheet)) setVisibility('private');
    setLoaded(true);
  }, [storageKey, firstSnapshot]);
  useEffect(() => {
    if (loaded)
      try {
        localStorage.setItem(storageKey, JSON.stringify(layout));
      } catch {
        /* Storage is optional. */
      }
  }, [layout, loaded, storageKey]);
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
  const [sync, setSync] = useState('Snapshot loaded');
  const [live, setLive] = useState(false);
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [denied, setDenied] = useState(false);
  const attention = useRoomAttention(snapshot, live, !denied);
  const [pending, setPending] = useState(false);
  const [invite, setInvite] = useState('');
  const [expression, setExpression] = useState('');
  const [rollType, setRollType] = useState('Manual roll');
  const [rollActor, setRollActor] = useState('');
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
  const diceTray = diceSelection(expression);
  const scene = snapshot.scenes.find(
    (s) => s.id === (snapshot.preparedSceneId ?? snapshot.game.active_scene_id),
  );
  const tabletopEdits = useTabletopEdits(
    `${snapshot.userId}:${snapshot.game.id}:${scene?.id ?? 'none'}`,
    scene?.id,
    run,
  );
  const actor = snapshot.actors.find((a) => a.id === selectedActor);
  const quickToken = snapshot.tokens.find(
    (t) =>
      t.id === quickActions?.tokenId &&
      t.scene_id === (snapshot.preparedSceneId ?? snapshot.game.active_scene_id),
  );
  const quickActor = snapshot.actors.find((a) => a.id === quickToken?.actor_id);
  function leaveQuickActions() {
    return (
      !quickBusy ||
      window.confirm(
        'A quick action is saving or unconfirmed. Close anyway? This does not cancel or reverse it; reopen the token to check the latest state.',
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
    changeLayout({ actor: id });
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
        const target = prepare.current;
        const response = await fetch(
          `/api/games/${initial.game.id}${target ? `?prepare=${encodeURIComponent(target)}` : ''}`,
          { cache: 'no-store' },
        );
        if (response.status === 403) {
          setDenied(true);
          return;
        }
        if (!response.ok) throw new Error('Sync failed');
        const updated: Snapshot = await response.json();
        if (target !== prepare.current) continue;
        if (!updated.preparedSceneId) prepare.current = undefined;
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
            (t) =>
              t.id === current?.tokenId &&
              t.scene_id === (updated.preparedSceneId ?? updated.game.active_scene_id),
          )
            ? current
            : undefined,
        );
        setLayout((current) =>
          !current.actor || updated.actors.some((a) => a.id === current.actor)
            ? current
            : { ...current, actor: undefined },
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
        setSync('Snapshot synced');
        setSyncedAt(Date.now());
      } while (refreshAgain.current);
    } catch {
      setSync('Snapshot sync failed');
    } finally {
      refreshRunning.current = false;
    }
  }, [initial.game.id]);
  useEffect(() => {
    const db = supabaseBrowser();
    let active = true;
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
        if (!active) return;
        setLive(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') void refresh();
      });
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    const foreground = () => {
      if (!document.hidden) void refresh();
    };
    const offline = () => setLive(false);
    window.addEventListener('online', foreground);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', foreground);
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('online', foreground);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', foreground);
      void db.removeChannel(channel);
    };
  }, [initial.game.id, refresh]);
  // A subscribed socket can miss an invalidation during reconnect. While a
  // creature is open, check one small RLS-filtered revision rather than
  // downloading the whole room on a fast timer.
  const inspectingActor = !!quickActions || !!selectedActor;
  useEffect(() => {
    if (!inspectingActor) return;
    const db = supabaseBrowser();
    let active = true;
    let checking = false;
    let revision: number | undefined;
    async function check() {
      if (checking || document.hidden || !navigator.onLine) return;
      checking = true;
      try {
        const { data } = await db
          .from('room_events')
          .select('revision')
          .eq('game_id', initial.game.id)
          .maybeSingle();
        if (active && data && data.revision !== revision) {
          revision = data.revision;
          await refresh();
        }
      } catch {
        // The existing channel and foreground/full refresh remain available.
      } finally {
        checking = false;
      }
    }
    const timer = setInterval(() => void check(), 1800);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [inspectingActor, initial.game.id, refresh]);
  async function run(command: Command, payload: unknown) {
    setError('');
    if (!navigator.onLine) {
      setError('Offline. Change not sent. Previously unconfirmed changes may still have saved.');
      return;
    }
    try {
      const stageEdit =
        command.startsWith('tabletop_') ||
        ['party_spawn', 'scene_grid', 'scene_calibrate', 'token_place'].includes(command);
      const result = await mutate(
        snapshot.game.id,
        command,
        stageEdit && snapshot.preparedSceneId && typeof payload === 'object' && payload
          ? { ...payload, preparing: true }
          : payload,
      );
      if (result.error) {
        setError(result.error);
        await refresh();
        if (result.rejected && command !== 'tabletop_history') return { rejected: result.error };
        return;
      }
      await refresh();
      return result.data;
    } catch {
      setError('Connection lost. Your change was not confirmed. Reload before retrying.');
    }
  }
  async function sendRoll(sheetRoll?: { actorId: string; expression: string; rollType: string }) {
    if (!navigator.onLine) {
      setError('Offline. Roll not sent. Previously unconfirmed rolls may still have saved.');
      return;
    }
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
    const sheetInitiative = sheetRoll?.rollType.trim().toLowerCase() === 'initiative';
    const key = JSON.stringify([finalExpression, actorId, visibility, type, sheetInitiative]);
    if (rollAttempt.current?.key !== key) rollAttempt.current = { key, id: crypto.randomUUID() };
    try {
      const result = await roll(snapshot.game.id, {
        id: rollAttempt.current.id,
        actor_id: actorId || null,
        expression: finalExpression,
        visibility,
        roll_type: type,
        ...(sheetInitiative ? { sheet_initiative: true } : {}),
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
        <span className={`connection ${live && attention.online ? 'connected' : ''}`} role="status">
          {attention.online
            ? live
              ? 'Live channel connected'
              : 'Live channel reconnecting'
            : 'Offline'}
          {' · '}
          {sync}
          <span aria-live="off">
            {' · '}
            {Math.max(0, Math.floor((attention.now - syncedAt) / 1000))}s ago
          </span>
        </span>
        <Link className="button ghost" href={`/games/${snapshot.game.id}/journal`} prefetch={false}>
          Journal
        </Link>
        <Link className="button ghost" href="/">
          Leave table ↗
        </Link>
      </header>
      <RoomShortcuts
        showAudience={false}
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
      <details className="room-presence">
        <summary>
          Who is online {attention.fresh ? `(${attention.members.length})` : '(unknown)'}
        </summary>
        <p>
          Presence uses heartbeats, not activity. Tabs expire after 12 seconds; suspended tabs may
          appear offline. Live-channel state is separate from snapshot polling.
        </p>
        <ul>
          {snapshot.members.map((m) => {
            const presence = attention.members.find((p) => p.user_id === m.user_id);
            return (
              <li key={m.user_id}>
                {m.display_name} ·{' '}
                {!attention.fresh
                  ? 'Unknown — presence unavailable'
                  : !presence
                    ? 'Offline'
                    : `${presence.live ? 'Online · live' : 'Online · reconnecting live channel'} · ${presence.tabs} tab(s)`}
              </li>
            );
          })}
        </ul>
      </details>
      {!attention.online && (
        <p role="alert">
          Offline. New changes cannot be confirmed. Do not repeat unconfirmed writes with new
          inputs; reconnect and check their state.
        </p>
      )}
      <div className="room-body">
        <Tabletop
          key={scene?.id ?? 'empty'}
          snapshot={snapshot}
          edits={tabletopEdits}
          run={run}
          attention={snapshot.preparedSceneId ? undefined : attention}
          openTokenSheet={(actorId) => {
            if (
              snapshot.actors.some((a) => a.id === actorId) &&
              leaveQuickActions() &&
              openSheet(actorId)
            )
              setQuickActions(undefined);
          }}
          openQuickActions={(tokenId, anchor) => {
            if (quickActions?.tokenId !== tokenId && !leaveQuickActions()) return false;
            const target = snapshot.tokens.find((t) => t.id === tokenId);
            if (
              gm &&
              quickActions?.tokenId !== tokenId &&
              monsterId(
                snapshot.actors.find((a) => a.id === target?.actor_id)?.sheet ?? emptySheet(),
              )
            )
              setVisibility('private');
            setQuickActions({ tokenId, anchor });
            return true;
          }}
          onPreviewChange={(preview) => {
            if (preview) {
              if (!leaveQuickActions()) return false;
              setQuickActions(undefined);
              setQuickBusy(false);
            }
            return true;
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
            refresh={refresh}
            visibility={visibility}
            onVisibilityChange={setVisibility}
            rollPending={pending}
            onAdvancedRoll={({ actorId, expression, rollType }) => {
              setRollActor(actorId);
              setExpression(expression);
              setRollType(rollType);
              setModifier('0');
              setTab('dice');
            }}
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
              <button
                key={t}
                aria-current={tab === t ? 'page' : undefined}
                className={tab === t ? 'active' : ''}
                onClick={() => setTab(t)}
              >
                {t === 'settings'
                  ? 'Settings'
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
            {tab === 'settings' && (
              <>
                <p>Table rules: {tableSystem(snapshot.game).label}</p>
                <PracticeTable role={snapshot.role} />
              </>
            )}
            {tab === 'encounter' && snapshot.preparedSceneId && (
              <p>
                Return to the live scene to run initiative. Add creatures and save encounter groups
                under Scenes.
              </p>
            )}
            {tab === 'encounter' && !snapshot.preparedSceneId && (
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
                        const kind = form.get('kind') || 'character';
                        const data = await run('actor_create', {
                          name: form.get('name'),
                          kind,
                          owner_id: form.get('owner_id') || snapshot.userId,
                          sheet: tableSystem(snapshot.game).createActorSheet(),
                        });
                        if (data?.id) {
                          openSheet(data.id, kind === 'character' && form.has('guided'));
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
                      <p className="small muted">
                        New actors use the {tableSystem(snapshot.game).label} sheet. Edit their
                        details on the sheet itself.
                      </p>
                      <label className="actor-builder-option dnd-check">
                        <input type="checkbox" name="guided" />
                        Open the guided builder for a player character
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
                    <>
                      <TableTokenList
                        key={scene.id}
                        tokens={snapshot.tokens.filter((token) => token.scene_id === scene.id)}
                        gm={gm}
                        onChange={(token, remove, folder) =>
                          run('token_organize', {
                            scene_id: token.scene_id,
                            id: token.id,
                            revision: token.revision,
                            remove,
                            folder,
                          })
                        }
                      />
                      <p className="small muted">
                        To place a linked token, choose a character in the map toolbar, then Click
                        to place or Place at party spawn.
                      </p>
                    </>
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
                saved={layout.roll}
                onSave={(roll) => changeLayout({ roll })}
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
                  <div className="dice-types" role="group" aria-label="Dice tray">
                    {snapshot.game.dice.map((d) => {
                      const count = diceTray.counts.get(d) ?? 0;
                      return (
                        <div className="dice-stepper" key={d}>
                          <button
                            aria-label={`Remove d${d}`}
                            disabled={diceTray.change(d, -1) === expression}
                            onClick={() =>
                              setExpression((value) => diceSelection(value).change(d, -1))
                            }
                          >
                            −
                          </button>
                          <button
                            aria-label={`Add d${d}`}
                            aria-description={`${count} in expression`}
                            className={count ? 'dice-selected' : undefined}
                            disabled={diceTray.change(d, 1) === expression}
                            onClick={() =>
                              setExpression((value) => diceSelection(value).change(d, 1))
                            }
                          >
                            d{d}
                            {count > 0 && <span className="dice-count"> ×{count}</span>}
                          </button>
                        </div>
                      );
                    })}
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
                  <div className="dice-expression">
                    <label>
                      Expression
                      <input
                        value={expression}
                        maxLength={500}
                        onChange={(e) => setExpression(e.target.value)}
                        placeholder="2d6 + 3"
                      />
                    </label>
                    <button
                      aria-label="Clear expression"
                      disabled={!expression}
                      onClick={() => setExpression('')}
                    >
                      Clear
                    </button>
                  </div>
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
                          const field = e.target.value;
                          if (field)
                            setExpression((v) => (v.trim() ? `${v} + ` : '') + `@{${field}}`);
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
                    disabled={pending || !expression.trim() || !rollType.trim()}
                    onClick={() => void sendRoll()}
                  >
                    {pending ? 'Rolling…' : '◇ Roll dice'}
                  </button>
                  <details>
                    <summary>Expression guide</summary>
                    <p className="small muted">
                      Use + − * / and parentheses. Try (2d6 + 3) / 2. Keep highest: 4d6kh3; lowest:
                      2d20kl1. Up to 100 dice per roll. Division keeps decimals. Sheet fields use
                      stable references inserted above. The minus buttons remove plain added dice;
                      edit grouped, subtracted, or keep-highest/lowest dice in the expression.
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
                <p>
                  {snapshot.preparedSceneId
                    ? `Preparing ${scene?.name} privately.`
                    : 'Viewing the players’ scene.'}
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={bringParty}
                    onChange={(e) => setBringParty(e.target.checked)}
                  />{' '}
                  Bring current party to the destination spawn when showing a scene. Existing
                  placements are kept.
                </label>
                {snapshot.scenes.map((s) => (
                  <article key={s.id} className="scene-card">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      width={72}
                      height={48}
                      style={{ objectFit: 'cover' }}
                      loading="lazy"
                      alt=""
                      src={`/api/images/${s.id}?scene=1&r=${s.revision}`}
                    />
                    <div>
                      <strong>{s.name}</strong>
                      <small>
                        {s.width} × {s.height} · {s.unit}
                      </small>
                    </div>
                    <button
                      disabled={s.id === scene?.id}
                      onClick={() => {
                        if (!leaveQuickActions()) return;
                        prepare.current = s.id;
                        void refresh();
                      }}
                    >
                      {s.id === scene?.id
                        ? 'Viewing'
                        : s.id === snapshot.game.active_scene_id
                          ? 'Return to live scene'
                          : 'Prepare'}
                    </button>
                    <button
                      disabled={s.id === snapshot.game.active_scene_id}
                      onClick={() =>
                        run('scene_publish', {
                          scene_id: s.id,
                          previous: snapshot.game.active_scene_id,
                          revision: s.revision,
                          party: bringParty,
                        })
                      }
                    >
                      {s.id === snapshot.game.active_scene_id ? 'Live' : 'Show to players'}
                    </button>
                  </article>
                ))}
                {scene && (
                  <>
                    <details>
                      <summary>Add creatures to {scene.name}</summary>
                      <MonsterLibrary snapshot={snapshot} run={run} />
                    </details>
                    <form
                      className="stack"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        if (
                          await run('group_save', {
                            scene_id: scene.id,
                            name: new FormData(form).get('name'),
                          })
                        )
                          form.reset();
                      }}
                    >
                      <label>
                        Encounter group name
                        <input name="name" required maxLength={100} />
                      </label>
                      <button>Save this scene’s NPCs and enemies as a group</button>
                    </form>
                    {snapshot.groups?.map((g) => (
                      <details key={g.id}>
                        <summary>
                          {g.name} ({g.labels.length})
                        </summary>
                        <p>
                          Drag onto the map or click to place at its center. Each copy starts
                          hidden.
                        </p>
                        {['Whole group', ...g.labels].map((label, i) => {
                          const payload = {
                            group_id: g.id,
                            scene_id: scene.id,
                            ...(i ? { member: i - 1 } : {}),
                          };
                          return (
                            <button
                              key={i}
                              draggable
                              onDragStart={(e) =>
                                e.dataTransfer.setData(
                                  'application/x-vtt-group',
                                  JSON.stringify(payload),
                                )
                              }
                              onClick={() => run('group_place', payload)}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </details>
                    ))}
                  </>
                )}
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
                      const data = await run('scene_draft', {
                        name: form.get('name'),
                        asset_id: assetId,
                      });
                      if (data?.id) {
                        element.reset();
                        prepare.current = data.id;
                        await refresh();
                      }
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
                <section className="stack" aria-label="Window layout">
                  <h3 className="section-divider">Window layout</h3>
                  <button
                    onClick={() =>
                      setLayout((current) => ({ actor: current.actor, detached: false }))
                    }
                  >
                    Reset window positions
                  </button>
                </section>
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
          audience={
            <label>
              Sheet roll visibility
              <select
                aria-label="Quick roll visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}
              >
                <option value="public">Everyone</option>
                <option value="private">{gm ? 'Only me' : 'Me and GM'}</option>
              </select>
            </label>
          }
          saved={layout.sheet}
          onSave={(sheet) => changeLayout({ sheet })}
          externalBusy={!!quickActor && selectedActor === quickActor.id && quickBusy}
          key={actor.id}
          actor={actor}
          snapshot={snapshot}
          run={run}
          onRoll={rollFromSheet}
          onClose={() => changeLayout({ actor: undefined })}
          error={error}
          onDirtyChange={trackSheetDirty}
          initialBuilderOpen={initialBuilderActor === actor.id}
        />
      )}
    </main>
  );
}

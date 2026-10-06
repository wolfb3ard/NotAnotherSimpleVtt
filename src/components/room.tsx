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
import { presentCue, type Presentation } from '@/lib/dice-presentation';
import { DiceStyleEditor } from './dice-style-editor';
import { SheetEditor } from './sheet-editor';

const Tabletop = dynamic(() => import('./tabletop'), {
  ssr: false,
  loading: () => <div className="canvas-empty">Loading tabletop…</div>,
});
const DiceOverlay = dynamic(() => import('./dice-overlay'), { ssr: false });
type Tab = 'party' | 'dice' | 'scenes' | 'settings' | 'appearance';

export function Room({ initial }: { initial: Snapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [tab, setTab] = useState<Tab>('party');
  const [selectedActor, setSelectedActor] = useState<string>();
  const [error, setError] = useState('');
  const [sync, setSync] = useState('Connecting');
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState(false);
  const [invite, setInvite] = useState('');
  const [expression, setExpression] = useState('1d20');
  const [rollActor, setRollActor] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [diceSetting, setDiceSetting] = useState(initial.game.dice.join(', '));
  const [createActor, setCreateActor] = useState(false);
  const [modifier, setModifier] = useState('0');
  const [animations, setAnimations] = useState<Presentation[]>([]);
  const seenCues = useRef(new Set(initial.rollCues?.map((c) => c.roll_id) ?? []));
  const clearAnimation = useCallback(() => setAnimations((queue) => queue.slice(1)), []);
  const rollAttempt = useRef<{ key: string; id: string } | null>(null);
  const refreshRunning = useRef(false);
  const refreshAgain = useRef(false);
  const gm = snapshot.role === 'gm';
  const scene = snapshot.scenes.find((s) => s.id === snapshot.game.active_scene_id);
  const actor = snapshot.actors.find((a) => a.id === selectedActor);
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
  async function sendRoll() {
    setPending(true);
    setError('');
    const finalExpression = Number(modifier)
      ? `(${expression}) + (${Number(modifier)})`
      : expression;
    const key = JSON.stringify([finalExpression, rollActor, visibility]);
    if (rollAttempt.current?.key !== key) rollAttempt.current = { key, id: crypto.randomUUID() };
    try {
      const result = await roll(snapshot.game.id, {
        id: rollAttempt.current.id,
        actor_id: rollActor || null,
        expression: finalExpression,
        visibility,
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
      setPending(false);
    }
  }
  function prepareRoll(actorId: string, value: string) {
    setRollActor(actorId);
    setExpression(value);
    setModifier('0');
    setTab('dice');
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
          ◈ GATHER
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
      <div className="room-body">
        <Tabletop
          key={scene?.id ?? 'empty'}
          snapshot={snapshot}
          run={run}
          selectActor={(id) => {
            if (snapshot.actors.some((a) => a.id === id)) {
              setSelectedActor(id);
              setTab('party');
            }
          }}
        >
          {animations[0] && (
            <DiceOverlay
              key={animations[0].id}
              presentation={animations[0]}
              onDone={clearAnimation}
              style={
                animations[0].masked
                  ? defaultDiceStyle
                  : (snapshot.diceStyles?.find((s) => s.user_id === animations[0].authorId)
                      ?.style ?? defaultDiceStyle)
              }
            />
          )}
        </Tabletop>
        <aside className="sidebar">
          <nav className="tabs" aria-label="Room panels">
            {(['party', 'dice', ...(gm ? ['scenes'] : []), 'appearance', 'settings'] as Tab[]).map(
              (t) => (
                <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {t === 'settings'
                    ? 'Room'
                    : t === 'appearance'
                      ? 'Style'
                      : t[0].toUpperCase() + t.slice(1)}
                </button>
              ),
            )}
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
                {actor ? (
                  <>
                    <button
                      className="ghost back-button"
                      onClick={() => setSelectedActor(undefined)}
                    >
                      ← All characters
                    </button>
                    <SheetEditor
                      key={actor.id}
                      actor={actor}
                      snapshot={snapshot}
                      run={run}
                      onRoll={prepareRoll}
                    />
                  </>
                ) : (
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
                    <p className="muted small">Characters, companions, and the occasional foe.</p>
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
                            sheet: template?.sheet || emptySheet(),
                          });
                          if (data?.id) {
                            setSelectedActor(data.id);
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
                        <button
                          className="actor-card"
                          key={a.id}
                          onClick={() => setSelectedActor(a.id)}
                        >
                          <span className={`avatar ${a.kind}`}>
                            {a.name.slice(0, 2).toUpperCase()}
                          </span>
                          <span>
                            <strong>{a.name}</strong>
                            <small>
                              {a.kind} ·{' '}
                              {snapshot.members.find((m) => m.user_id === a.owner_id)?.display_name}
                            </small>
                          </span>
                          <span className="arrow">›</span>
                        </button>
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
                              const file = form.get('image') as File;
                              const assetId = file?.size ? await imageUpload(file, 'token') : null;
                              await run('token_create', {
                                actor_id: form.get('actor_id'),
                                scene_id: scene.id,
                                asset_id: assetId,
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
                          <label>
                            Token image (optional)
                            <input
                              name="image"
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                            />
                          </label>
                          <button disabled={pending}>Place token</button>
                          <p className="small muted">
                            New tokens start near the map’s top-left. The GM may need to reveal that
                            area.
                          </p>
                        </form>
                      </details>
                    )}
                  </>
                )}
              </>
            )}
            {tab === 'dice' && (
              <div className="stack">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">LET FATE DECIDE</span>
                    <h2>Roll the dice</h2>
                  </div>
                  <span className="dice-icon">◇</span>
                </div>
                <div className="dice-types">
                  {snapshot.game.dice.map((d) => (
                    <button key={d} onClick={() => setExpression(`1d${d}`)}>
                      d{d}
                    </button>
                  ))}
                </div>
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
                  disabled={pending || !expression}
                  onClick={sendRoll}
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
                      <strong>{r.author_name}</strong>
                      <span className="small muted">
                        {r.visibility === 'private'
                          ? '🔒 Private'
                          : new Date(r.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                      </span>
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
                      onClick={() =>
                        run('scene_update', {
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
                      onClick={() =>
                        run('scene_update', { id: scene.id, revision: scene.revision, fog: [] })
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
    </main>
  );
}

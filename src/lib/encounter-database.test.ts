import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { Encounter } from './types';
import { createDndSheet } from './dnd';
import { createMonsterSheet } from './srd-monsters';
import { initiativeInput } from './initiative';
import { rollDice } from './dice';

let db: PGlite, game: string, scene: string, secondScene: string, foreignGame: string;
const gm = randomUUID(),
  player = randomUUID(),
  outsider = randomUUID();
let hero: string, monster: string, secret: string, fogged: string, secondToken: string;
async function as(user: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
}
async function mutate(name: string, payload: unknown) {
  return (
    await db.query<{ value: Record<string, string> }>('select mutate_game($1,$2,$3::jsonb) value', [
      game,
      name,
      JSON.stringify(payload),
    ])
  ).rows[0].value;
}
async function snapshot(targetScene = scene, targetGame = game) {
  return (
    await db.query<{ value: Encounter | null }>('select encounter_snapshot($1,$2) value', [
      targetGame,
      targetScene,
    ])
  ).rows[0].value;
}
async function command(p: Record<string, unknown>, targetGame = game) {
  return (
    await db.query<{ value: Record<string, string> }>(
      'select encounter_command($1,$2::jsonb) value',
      [targetGame, JSON.stringify(p)],
    )
  ).rows[0].value;
}
function start(
  participants: { token_id: string; initiative: number | null }[] = [
    { token_id: hero, initiative: 10 },
    { token_id: monster, initiative: 10 },
    { token_id: secret, initiative: 20 },
  ],
) {
  return { action: 'start', scene_id: scene, operation_id: randomUUID(), participants };
}
async function change(action: string, extra = {}) {
  const current = (await snapshot())!;
  return {
    action,
    scene_id: scene,
    operation_id: randomUUID(),
    id: current.id,
    revision: current.revision,
    ...extra,
  };
}
async function packet(token: string, die = 10) {
  const row = (
    await db.query<{
      actor_id: string;
      revision: number;
      sheet: Parameters<typeof initiativeInput>[0];
      actor_revision: number;
    }>(
      'select t.actor_id,t.revision,a.sheet,a.revision actor_revision from tokens t join actors a on a.id=t.actor_id where t.id=$1',
      [token],
    )
  ).rows[0];
  const input = initiativeInput(row.sheet);
  return {
    token_id: token,
    token_revision: row.revision,
    actor_id: row.actor_id,
    actor_revision: row.actor_revision,
    roll_id: randomUUID(),
    expression: input.expression,
    result: rollDice(input.expression, [4, 6, 8, 10, 12, 20, 100], input.fields, () => die),
  };
}
async function commit(p: unknown, rolls: unknown[], user = gm) {
  await db.exec('reset role; set role service_role');
  try {
    return (
      await db.query<{ value: Record<string, string> }>(
        'select commit_encounter_rolls($1,$2,$3::jsonb,$4::jsonb) value',
        [user, game, JSON.stringify(p), JSON.stringify(rolls)],
      )
    ).rows[0].value;
  } finally {
    await as(gm);
  }
}
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create publication supabase_realtime;
  `);
  const root = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(root)).sort())
    await db.exec(await readFile(new URL(file, root), 'utf8'));
  await db.query('insert into auth.users values($1),($2),($3)', [gm, player, outsider]);
  await as(gm);
  game = (await db.query<{ id: string }>("select create_game('Encounter','GM') id")).rows[0].id;
  const invite = await mutate('invite', {});
  await as(player);
  await db.query("select accept_invite($1,'Player')", [invite.token]);
  await as(outsider);
  foreignGame = (await db.query<{ id: string }>("select create_game('Other','Other GM') id"))
    .rows[0].id;
  const map = randomUUID();
  await db.exec('reset role');
  await db.query(
    "insert into assets(id,game_id,owner_id,kind,path,width,height) values($1,$2,$3,'background','encounter-map.webp',300,300)",
    [map, game, gm],
  );
  await as(gm);
  for (const name of ['First', 'Second']) await mutate('scene_create', { name, asset_id: map });
  const scenes = (await db.query<{ id: string }>('select id from scenes order by name')).rows;
  scene = scenes[0].id;
  secondScene = scenes[1].id;
  const pc = (
    await mutate('actor_create', {
      name: 'Hero',
      kind: 'character',
      owner_id: player,
      sheet: createDndSheet(),
    })
  ).id;
  const npc = (
    await mutate('actor_create', {
      name: 'Monster',
      kind: 'enemy',
      owner_id: gm,
      sheet: createMonsterSheet('monster-aboleth'),
    })
  ).id;
  const enemy = (
    await mutate('actor_create', {
      name: 'Secret enemy',
      kind: 'enemy',
      owner_id: gm,
      sheet: createMonsterSheet('monster-lich'),
    })
  ).id;
  for (const actor of [pc, npc, enemy, npc])
    await db.query('select place_actor_token($1,$2,$3)', [game, actor, scene]);
  const tokens = (
    await db.query<{ id: string; actor_id: string }>(
      'select id,actor_id from tokens order by label,id',
    )
  ).rows;
  hero = tokens.find((t) => t.actor_id === pc)!.id;
  secret = tokens.find((t) => t.actor_id === enemy)!.id;
  [monster, fogged] = tokens.filter((t) => t.actor_id === npc).map((t) => t.id);
  await db.query('select place_actor_token($1,$2,$3)', [game, pc, secondScene]);
  secondToken = (
    await db.query<{ id: string }>('select id from tokens where scene_id=$1', [secondScene])
  ).rows[0].id;
}, 30000);
beforeEach(async () => {
  await db.exec(
    'reset role; delete from public.encounters; delete from public.encounter_receipts; delete from public.rolls',
  );
  await db.query('update games set gm_id=$1,active_scene_id=$2,dice=default where id=$3', [
    gm,
    scene,
    game,
  ]);
  await db.query(
    'update scenes set fog=\'[{"x":0,"y":0,"width":200,"height":300,"reveal":true}]\'::jsonb where game_id=$1',
    [game],
  );
  await db.query(
    'update tokens set hidden=(id=$1),x=case when id=$2 then 250 else 100 end,revision=revision+1 where game_id=$3',
    [secret, fogged, game],
  );
  await as(gm);
});
afterAll(async () => {
  await db?.close();
});

describe.sequential('authorized encounter lifecycle', () => {
  it('starts in descending initiative with stable ties and retries without a second encounter', async () => {
    const request = start();
    const result = await command(request);
    expect(await command(request)).toEqual(result);
    const e = (await snapshot())!;
    expect(e.participants.map((p) => p.token_id)).toEqual([secret, hero, monster]);
    expect(e).toMatchObject({ status: 'active', round: 1, active_token_id: secret });
    await expect(command({ ...request, participants: [request.participants[0]] })).rejects.toThrow(
      /already used/,
    );
    await expect(command(start())).rejects.toThrow(/live encounter/);
  });
  it('omits hidden/fogged identities, counts, order gaps, private revisions and sheets from player projections', async () => {
    await command(start([...start().participants, { token_id: fogged, initiative: 99 }]));
    await as(player);
    const e = (await snapshot())!;
    expect(e.participants.map((p) => p.token_id)).toEqual([hero, monster]);
    expect(e.active_token_id).toBeNull();
    expect(e.revision).toBe(0);
    const text = JSON.stringify(e);
    for (const value of [
      secret,
      fogged,
      'Secret enemy',
      'position',
      'actor_id',
      'sheet',
      'expression',
      'controller_id',
    ])
      expect(text).not.toContain(value);
    await expect(db.query('select * from encounters')).rejects.toThrow(/permission denied/);
    await expect(db.query('select * from encounter_participants')).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query('select * from encounter_receipts')).rejects.toThrow(/permission denied/);
  });
  it('advances once across retries and rejects a concurrent stale GM turn advance', async () => {
    await command(start());
    const first = await change('next'),
      competing = await change('next');
    const result = await command(first);
    expect(await command(first)).toEqual(result);
    await expect(command(competing)).rejects.toThrow(/changed/);
    expect((await snapshot())!.active_token_id).toBe(hero);
    await command(await change('next'));
    await command(await change('next'));
    expect(await snapshot()).toMatchObject({ round: 2, active_token_id: secret });
  });
  it('supports manual scores, tie reorder and rerolls without stealing the current turn', async () => {
    await command(start());
    await command(await change('initiative', { changes: [{ token_id: hero, value: 35.5 }] }));
    expect((await snapshot())!.participants[0]).toMatchObject({ token_id: hero, initiative: 35.5 });
    expect((await snapshot())!.active_token_id).toBe(secret);
    await command(await change('reorder', { token_ids: [monster, secret, hero] }));
    expect((await snapshot())!.participants.map((p) => p.token_id)).toEqual([
      monster,
      secret,
      hero,
    ]);
    expect((await snapshot())!.active_token_id).toBe(secret);
    await expect(command(await change('reorder', { token_ids: [hero] }))).rejects.toThrow(
      /every participant/,
    );
  });
  it('serializes competing asynchronous next-turn submissions against the same revision', async () => {
    await command(start());
    const a = await change('next'),
      b = await change('next');
    const results = await Promise.allSettled([command(a), command(b)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await snapshot()).toMatchObject({ active_token_id: hero, round: 1 });
  });
  it('pauses/resumes/ends explicitly, preserves rounds and allows a new encounter after end', async () => {
    await command(start());
    await command(await change('pause'));
    await expect(command(await change('next'))).rejects.toThrow(/Resume/);
    expect(await snapshot()).toMatchObject({ status: 'paused', round: 1, active_token_id: secret });
    await command(await change('resume'));
    await command(await change('end'));
    expect(await snapshot()).toMatchObject({ status: 'ended', active_token_id: null });
    await expect(command(await change('resume'))).rejects.toThrow(/ended/);
    await command(start());
    expect((await snapshot())!.status).toBe('active');
  });
  it('adds/removes participants, selects the next survivor and pauses an empty encounter', async () => {
    await command(start([{ token_id: hero, initiative: 10 }]));
    await command(
      await change('add', {
        participants: [
          { token_id: secret, initiative: 20 },
          { token_id: monster, initiative: 5 },
        ],
      }),
    );
    expect((await snapshot())!.active_token_id).toBe(hero);
    await command(await change('remove', { token_ids: [hero] }));
    expect((await snapshot())!.active_token_id).toBe(monster);
    await command(await change('remove', { token_ids: [monster] }));
    expect(await snapshot()).toMatchObject({ active_token_id: secret, round: 2 });
    await command(await change('remove', { token_ids: [secret] }));
    expect(await snapshot()).toMatchObject({
      status: 'paused',
      active_token_id: null,
      participants: [],
    });
    await expect(command(await change('resume'))).rejects.toThrow(/Add participants/);
    await command(await change('add', { participants: [{ token_id: hero, initiative: -2 }] }));
    await command(await change('resume'));
    expect((await snapshot())!.active_token_id).toBe(hero);
  });
  it('records server-generated initiative atomically as silent GM-private rolls and deduplicates retries', async () => {
    const request = start([
      { token_id: hero, initiative: null },
      { token_id: secret, initiative: null },
    ]);
    const packets = [await packet(hero, 9), await packet(secret, 14)];
    const result = await commit(request, packets);
    expect(await commit(request, [await packet(hero, 1), await packet(secret, 1)])).toEqual(result);
    expect((await db.query('select id from rolls')).rows).toHaveLength(2);
    expect((await db.query('select * from roll_cues')).rows).toHaveLength(0);
    expect((await db.query('select distinct visibility,roll_type from rolls')).rows).toEqual([
      { visibility: 'private', roll_type: 'Encounter initiative' },
    ]);
    await as(player);
    expect((await db.query('select id from rolls')).rows).toHaveLength(0);
  });
  it('allows server rerolls while preserving the active token and rolls back stale source batches', async () => {
    await command(start());
    const request = await change('roll', { token_ids: [hero, monster] });
    const packets = [await packet(hero), await packet(monster)];
    await db.exec('reset role');
    await db.query('update actors set revision=revision+1 where id=$1', [packets[1].actor_id]);
    await as(gm);
    await expect(commit(request, packets)).rejects.toThrow(/source changed/);
    expect((await db.query('select id from rolls')).rows).toHaveLength(0);
    expect((await snapshot())!.participants.find((p) => p.token_id === hero)!.initiative).toBe(10);
    await commit(request, [await packet(hero, 17), await packet(monster, 18)]);
    expect((await snapshot())!.active_token_id).toBe(secret);
  });
  it('rejects forged rolls on the authenticated API and rolls from a revoked GM', async () => {
    await expect(command(start([{ token_id: hero, initiative: null }]))).rejects.toThrow(
      /Server initiative roll/,
    );
    await expect(
      db.query('select commit_encounter_rolls($1,$2,$3::jsonb,$4::jsonb)', [
        gm,
        game,
        JSON.stringify(start()),
        '[]',
      ]),
    ).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
    await db.query('update games set gm_id=$1 where id=$2', [player, game]);
    await as(gm);
    await expect(commit(start(), [])).rejects.toThrow(/GM required/);
  });
  it('rechecks allowed dice at commit and rolls back the entire encounter if settings changed', async () => {
    const request = start([{ token_id: hero, initiative: null }]);
    const roll = await packet(hero, 12);
    await db.exec('reset role');
    await db.query('update games set dice=array[6] where id=$1', [game]);
    await as(gm);
    await expect(commit(request, [roll])).rejects.toThrow(/Dice settings changed/);
    expect(await snapshot()).toBeNull();
    expect((await db.query('select id from rolls')).rows).toHaveLength(0);
  });
  it('denies players including the active owner/controller, strangers and anonymous calls', async () => {
    const request = start([{ token_id: hero, initiative: 10 }]);
    await command(request);
    const next = await change('next');
    await as(player);
    expect((await snapshot())!.active_token_id).toBe(hero);
    await expect(command(next)).rejects.toThrow(/GM required/);
    await expect(command(start())).rejects.toThrow(/GM required/);
    await as(outsider);
    await expect(snapshot()).rejects.toThrow(/access denied/);
    await expect(command(next)).rejects.toThrow(/GM required/);
    await db.exec('reset role; set role anon');
    await expect(snapshot()).rejects.toThrow(/permission denied/);
    await expect(command(next)).rejects.toThrow(/permission denied/);
  });
  it('rechecks visibility on every read without hidden placeholders when a token is revealed/concealed', async () => {
    await command(start());
    await db.exec('reset role');
    await db.query('update tokens set hidden=false where id=$1', [secret]);
    await as(player);
    expect((await snapshot())!.active_token_id).toBe(secret);
    await db.exec('reset role');
    await db.query('update tokens set hidden=true where id=$1', [secret]);
    await as(player);
    expect((await snapshot())!.active_token_id).toBeNull();
    expect((await snapshot())!.participants.some((p) => p.token_id === secret)).toBe(false);
  });
  it('isolates scenes, restores their current state on return and rejects inactive/foreign requests', async () => {
    await command(start());
    const next = await change('next');
    await mutate('scene_activate', { id: secondScene });
    await expect(command(next)).rejects.toThrow(/Active scene/);
    expect(await snapshot()).toBeNull();
    expect(await snapshot(secondScene)).toBeNull();
    await expect(command({ ...start(), scene_id: secondScene })).rejects.toThrow(
      /Token unavailable/,
    );
    const secondRequest = {
      ...start([{ token_id: secondToken, initiative: 12 }]),
      scene_id: secondScene,
    };
    await command(secondRequest);
    expect((await snapshot(secondScene))!.active_token_id).toBe(secondToken);
    await as(player);
    expect(await snapshot()).toBeNull();
    expect((await snapshot(secondScene))!.participants.map((p) => p.token_id)).toEqual([
      secondToken,
    ]);
    await as(gm);
    await expect(command(start(), foreignGame)).rejects.toThrow(/GM required/);
    await mutate('scene_activate', { id: scene });
    expect((await snapshot())!.active_token_id).toBe(secret);
    await command(next);
    expect((await snapshot())!.active_token_id).toBe(hero);
  });
  it('rejects invalid/missing/duplicate participants and malformed commands without partial writes', async () => {
    for (const request of [
      { ...start(), participants: [] },
      {
        ...start(),
        participants: [
          { token_id: hero, initiative: 1 },
          { token_id: hero, initiative: 2 },
        ],
      },
      { ...start(), participants: [{ token_id: hero, initiative: 'NaN' }] },
      { ...start(), participants: [{ token_id: randomUUID(), initiative: 5 }] },
      { ...start(), hidden: false },
      { ...start(), action: 'unknown' },
    ])
      await expect(command(request)).rejects.toThrow(/Invalid|unavailable/);
    expect(await snapshot()).toBeNull();
  });
  it('keeps receipts after source deletion and rejects receipt replay after GM-role loss', async () => {
    const request = start();
    const result = await command(request);
    await db.exec('reset role');
    await db.query('delete from encounter_participants where token_id=$1', [hero]);
    await as(gm);
    expect(
      (
        await db.query<{ value: unknown }>('select encounter_receipt($1,$2::jsonb) value', [
          game,
          JSON.stringify(request),
        ])
      ).rows[0].value,
    ).toEqual(result);
    await db.exec('reset role');
    await db.query('update games set gm_id=$1 where id=$2', [player, game]);
    await as(gm);
    await expect(command(request)).rejects.toThrow(/GM required/);
    await expect(
      db.query('select encounter_receipt($1,$2::jsonb)', [game, JSON.stringify(request)]),
    ).rejects.toThrow(/GM required/);
  });
  it('reconciles deletion of the current token and safely cascades scene/game deletion', async () => {
    await command(start());
    await db.exec('reset role');
    // Direct administrative deletion exercises the same FK/trigger path as actor deletion.
    await db.query('delete from tokens where id=$1', [secret]);
    await as(gm);
    expect((await snapshot())!.active_token_id).toBe(hero);
    await db.exec('reset role');
    await db.query('delete from games where id=$1', [game]);
    expect((await db.query('select * from encounters')).rows).toHaveLength(0);
    expect((await db.query('select * from encounter_participants')).rows).toHaveLength(0);
    expect((await db.query('select * from encounter_receipts')).rows).toHaveLength(0);
  });
});

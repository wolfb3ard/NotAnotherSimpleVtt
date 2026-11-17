import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { createDndSheet, dndId } from './dnd';
import { emptyCombat, type Combat } from './combat';
import { createMonsterSheet } from './srd-monsters';
import { monsterHpId, monsterTemporaryHpId } from './monster-sheet';
import { temporaryHpId } from './resources';

let db: PGlite, game: string, actor: string, enemy: string, scene: string;
let heroToken: string, enemyToken: string;
const gm = randomUUID(),
  player = randomUUID(),
  outsider = randomUUID();
async function as(user: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
}
async function mutate(name: string, payload: unknown) {
  return (
    await db.query<{ v: Record<string, string> }>('select mutate_game($1,$2,$3::jsonb) v', [
      game,
      name,
      JSON.stringify(payload),
    ])
  ).rows[0].v;
}
async function read(id = actor) {
  return (
    await db.query<{ combat: Combat; combat_revision: number }>(
      'select combat,combat_revision from actors where id=$1',
      [id],
    )
  ).rows[0];
}
async function save(
  state: Combat,
  revision = 0,
  operation = randomUUID(),
  id = actor,
  targetGame = game,
) {
  return (
    await db.query<{ v: Record<string, string> }>(
      'select save_actor_combat($1,$2,$3,$4,$5::jsonb) v',
      [targetGame, id, revision, operation, JSON.stringify(state)],
    )
  ).rows[0].v;
}
async function encounter(action: string, extra = {}) {
  const current = (
    await db.query<{ v: { id: string; revision: number } }>('select encounter_snapshot($1,$2) v', [
      game,
      scene,
    ])
  ).rows[0].v;
  return (
    await db.query<{ v: Record<string, string> }>('select encounter_command($1,$2::jsonb) v', [
      game,
      JSON.stringify({
        action,
        scene_id: scene,
        operation_id: randomUUID(),
        ...(action === 'start' ? {} : { id: current.id, revision: current.revision }),
        ...extra,
      }),
    ])
  ).rows[0].v;
}
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create publication supabase_realtime;`);
  const root = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(root)).sort())
    await db.exec(await readFile(new URL(file, root), 'utf8'));
  await db.query('insert into auth.users values($1),($2),($3)', [gm, player, outsider]);
  await as(gm);
  game = (await db.query<{ id: string }>("select create_game('Combat','GM') id")).rows[0].id;
  const invite = await mutate('invite', {});
  await as(player);
  await db.query("select accept_invite($1,'Player')", [invite.token]);
  await as(gm);
  actor = (
    await mutate('actor_create', {
      name: 'Hero',
      kind: 'character',
      owner_id: player,
      sheet: createDndSheet(),
    })
  ).id;
  enemy = (
    await mutate('actor_create', {
      name: 'Enemy',
      kind: 'enemy',
      owner_id: gm,
      sheet: createMonsterSheet('monster-aboleth'),
    })
  ).id;
  const map = randomUUID();
  await db.exec('reset role');
  await db.query(
    "insert into assets(id,game_id,owner_id,kind,path,width,height) values($1,$2,$3,'background','combat.webp',300,300)",
    [map, game, gm],
  );
  await as(gm);
  await mutate('scene_create', { name: 'Arena', asset_id: map });
  scene = (await db.query<{ id: string }>('select id from scenes where game_id=$1', [game])).rows[0]
    .id;
  heroToken = (
    await db.query<{ v: string }>('select place_actor_token($1,$2,$3) v', [game, actor, scene])
  ).rows[0].v;
  enemyToken = (
    await db.query<{ v: string }>('select place_actor_token($1,$2,$3) v', [game, enemy, scene])
  ).rows[0].v;
  // Placement returns JSON, so read IDs from their authoritative rows.
  heroToken = (await db.query<{ id: string }>('select id from tokens where actor_id=$1', [actor]))
    .rows[0].id;
  enemyToken = (await db.query<{ id: string }>('select id from tokens where actor_id=$1', [enemy]))
    .rows[0].id;
}, 30000);
beforeEach(async () => {
  await db.exec(
    'reset role; delete from encounters; delete from encounter_receipts; delete from vtt_private.combat_receipts',
  );
  await db.query('update actors set combat=$1::jsonb,combat_revision=0', [
    JSON.stringify(emptyCombat()),
  ]);
  await as(gm);
});
afterAll(async () => {
  await db?.close();
});

it('defaults old actors safely and rejects direct writes', async () => {
  expect((await read()).combat).toEqual(emptyCombat());
  await expect(
    db.query('update actors set combat_revision=9 where id=$1', [actor]),
  ).rejects.toThrow();
});
it('authorizes owner edits, exact retries and stale concurrent rejection independently of sheet revision', async () => {
  await as(player);
  const state = emptyCombat();
  state.death.successes = 1;
  const op = randomUUID(),
    first = await save(state, 0, op);
  expect(await save(state, 0, op)).toEqual(first);
  await expect(save(emptyCombat(), 0, op)).rejects.toThrow('Operation already used');
  await expect(save(state, 0)).rejects.toThrow('Combat changed');
  expect(
    (await db.query<{ revision: number }>('select revision from actors where id=$1', [actor]))
      .rows[0].revision,
  ).toBe(0);
});
it('denies controllers without sheet edit, outsiders, foreign games and revoked retry permissions', async () => {
  const state = emptyCombat();
  const op = randomUUID();
  await save(state, 0, op, enemy);
  await as(player);
  await expect(save(state, 0, randomUUID(), enemy)).rejects.toThrow('Combat edit denied');
  expect(await read(enemy)).toBeUndefined();
  await as(outsider);
  await expect(save(state)).rejects.toThrow('Game access denied');
  await as(gm);
  await expect(save(state, 0, op, enemy, randomUUID())).rejects.toThrow('Game access denied');
  await as(player);
  await expect(save(state, 0, op, enemy)).rejects.toThrow('Combat edit denied');
});
it('keeps view grants read-only and independent creatures isolated', async () => {
  const state = emptyCombat();
  state.conditions.push({
    id: randomUUID(),
    name: 'Poisoned',
    source: 'Secret trap',
    notes: 'GM detail',
    expiry: null,
    due: false,
  });
  await save(state, 0, randomUUID(), enemy);
  expect((await read()).combat.conditions).toEqual([]);
  await mutate('grant', { actor_id: enemy, user_id: player, access: 'view' });
  await as(player);
  expect((await read(enemy)).combat).toEqual(state);
  await expect(save(emptyCombat(), 1, randomUUID(), enemy)).rejects.toThrow('Combat edit denied');
});
it.each([
  { ...emptyCombat(), death: { successes: 4, failures: 0, stable: false } },
  { ...emptyCombat(), death: { successes: 0.5, failures: 0, stable: false } },
  { ...emptyCombat(), concentration: { source: '', notes: '', checks: [] } },
  { ...emptyCombat(), extra: 'secret' },
  {
    ...emptyCombat(),
    conditions: [{ id: randomUUID(), name: '', source: '', notes: '', expiry: null, due: false }],
  },
])('validates forged state in SQL, not only actions', async (state) => {
  await expect(save(state as Combat)).rejects.toThrow('Invalid combat state');
});
it('prompts start/end expiry without removal and supports keep/remove overrides', async () => {
  await encounter('start', {
    participants: [
      { token_id: heroToken, initiative: 20 },
      { token_id: enemyToken, initiative: 10 },
    ],
  });
  const e = (
    await db.query<{ v: { id: string } }>('select encounter_snapshot($1,$2) v', [game, scene])
  ).rows[0].v;
  const state = emptyCombat();
  state.conditions = [
    {
      id: randomUUID(),
      name: 'End marker',
      source: 'Spell',
      notes: 'Review save',
      expiry: { encounter_id: e.id, round: 1, phase: 'end' },
      due: false,
    },
    {
      id: randomUUID(),
      name: 'Start marker',
      source: 'Spell',
      notes: '',
      expiry: { encounter_id: e.id, round: 2, phase: 'start' },
      due: false,
    },
  ];
  await save(state);
  await encounter('next');
  expect((await read()).combat.conditions.map((c) => c.due)).toEqual([true, false]);
  await encounter('next');
  const latest = await read();
  expect(latest.combat.conditions.map((c) => c.due)).toEqual([true, true]);
  latest.combat.conditions.splice(0, 1);
  latest.combat.conditions[0].expiry = null;
  latest.combat.conditions[0].due = false;
  await save(latest.combat, latest.combat_revision);
  expect((await read()).combat.conditions[0].due).toBe(false);
});
it('rejects foreign/non-participating expiry anchors', async () => {
  const state = emptyCombat();
  state.conditions = [
    {
      id: randomUUID(),
      name: 'Stunned',
      source: '',
      notes: '',
      expiry: { encounter_id: randomUUID(), round: 1, phase: 'end' },
      due: false,
    },
  ];
  await expect(save(state)).rejects.toThrow('Expiry target unavailable');
});
it('prompts concentration on HP and temporary HP damage without resolving checks or death saves', async () => {
  // Use monster HP so full printed statistics test the same path as PCs.
  const state = emptyCombat();
  state.concentration = { source: 'Spell', notes: 'Advantage applies manually', checks: [] };
  await save(state, 0, randomUUID(), enemy);
  const sheet = (
    await db.query<{ sheet: ReturnType<typeof createDndSheet> }>(
      'select sheet from actors where id=$1',
      [enemy],
    )
  ).rows[0].sheet;
  const hp = sheet.sections.flatMap((s) => s.fields).find((f) => f.id === monsterHpId)!;
  await db.query('select adjust_actor_resources($1,$2,0,$3,$4::jsonb)', [
    game,
    enemy,
    randomUUID(),
    JSON.stringify([{ id: hp.id, value: Number(hp.value) - 40 }]),
  ]);
  let current = await read(enemy);
  expect(current.combat.concentration!.checks).toMatchObject([{ damage: 40, dc: 20 }]);
  expect(current.combat.death).toEqual(emptyCombat().death);
  const sheetRev = (
    await db.query<{ revision: number }>('select revision from actors where id=$1', [enemy])
  ).rows[0].revision;
  await db.query('select adjust_actor_resources($1,$2,$3,$4,$5::jsonb)', [
    game,
    enemy,
    sheetRev,
    randomUUID(),
    JSON.stringify([{ id: monsterTemporaryHpId, value: 20 }]),
  ]);
  await db.query('select adjust_actor_resources($1,$2,$3,$4,$5::jsonb)', [
    game,
    enemy,
    sheetRev + 1,
    randomUUID(),
    JSON.stringify([{ id: monsterTemporaryHpId, value: 5 }]),
  ]);
  current = await read(enemy);
  expect(current.combat.concentration!.checks).toMatchObject([{ dc: 20 }, { damage: 15, dc: 10 }]);
  current.combat.concentration = null;
  await save(current.combat, current.combat_revision, randomUUID(), enemy);
  expect((await read(enemy)).combat.concentration).toBeNull();
});
it('retains explicit defeated/stable/revived overrides without rewriting HP', async () => {
  const state = emptyCombat();
  state.death.failures = 3;
  await save(state);
  state.death = { successes: 3, failures: 0, stable: true };
  await save(state, 1);
  await save(emptyCombat(), 2);
  expect((await read()).combat.death).toEqual(emptyCombat().death);
  expect(dndId('hp')).toBe('5e202024-0000-4000-8000-0000513ad265');
});
it('rechecks revoked permissions before returning an old receipt', async () => {
  await mutate('grant', { actor_id: enemy, user_id: player, access: 'edit' });
  await as(player);
  const operation = randomUUID();
  await save(emptyCombat(), 0, operation, enemy);
  await as(gm);
  await mutate('grant', { actor_id: enemy, user_id: player, access: 'none' });
  await as(player);
  await expect(save(emptyCombat(), 0, operation, enemy)).rejects.toThrow('Combat edit denied');
  expect(await read(enemy)).toBeUndefined();
});
it('never leaks markers through encounter projections or marks expiry during pause/end', async () => {
  await encounter('start', {
    participants: [
      { token_id: heroToken, initiative: 20 },
      { token_id: enemyToken, initiative: 10 },
    ],
  });
  const e = (
    await db.query<{ v: { id: string } }>('select encounter_snapshot($1,$2) v', [game, scene])
  ).rows[0].v;
  const state = emptyCombat();
  state.conditions = [
    {
      id: randomUUID(),
      name: 'Secret curse',
      source: 'Unrevealed caster',
      notes: 'GM notes',
      expiry: { encounter_id: e.id, round: 1, phase: 'end' },
      due: false,
    },
  ];
  await save(state, 0, randomUUID(), enemy);
  await encounter('pause');
  expect((await read(enemy)).combat.conditions[0].due).toBe(false);
  await encounter('resume');
  await as(player);
  const projection = (await db.query('select encounter_snapshot($1,$2)', [game, scene])).rows;
  expect(JSON.stringify(projection)).not.toMatch(/Secret curse|Unrevealed caster|GM notes/);
  await as(gm);
  await encounter('end');
  expect((await read(enemy)).combat.conditions[0].due).toBe(false);
  const current = await read(enemy);
  current.combat.conditions = [];
  await save(current.combat, current.combat_revision, randomUUID(), enemy);
});
it('records PC damage/temp-HP prompts atomically, deduplicates retries, and rejects stale overrides', async () => {
  // Explicit fixture setup; configuration changes retain the existing actor sheet.
  await db.exec('reset role');
  const sheet = createDndSheet();
  const hp = sheet.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('hp'))!;
  hp.value = 60;
  hp.max = 60;
  sheet.sections
    .find((s) => s.fields.includes(hp))!
    .fields.push({
      id: temporaryHpId,
      label: 'Temporary HP',
      kind: 'resource',
      value: 10,
      max: 1e12,
    });
  await db.query('update actors set sheet=$1::jsonb where id=$2', [JSON.stringify(sheet), actor]);
  await as(player);
  const state = emptyCombat();
  state.concentration = { source: 'Bless', notes: '', checks: [] };
  await save(state);
  const rev = (
    await db.query<{ revision: number }>('select revision from actors where id=$1', [actor])
  ).rows[0].revision;
  const operation = randomUUID(),
    changes = JSON.stringify([
      { id: temporaryHpId, value: 0 },
      { id: dndId('hp'), value: 30 },
    ]);
  for (let i = 0; i < 2; i++)
    await db.query('select adjust_actor_resources($1,$2,$3,$4,$5::jsonb)', [
      game,
      actor,
      rev,
      operation,
      changes,
    ]);
  const current = await read();
  expect(current.combat.concentration!.checks).toMatchObject([{ damage: 40, dc: 20 }]);
  expect(current.combat_revision).toBe(2);
  await expect(save(state, 1)).rejects.toThrow('Combat changed');
  // Healing is not damage and cannot clear an unanswered reminder.
  await db.query('select adjust_actor_resources($1,$2,$3,$4,$5::jsonb)', [
    game,
    actor,
    rev + 1,
    randomUUID(),
    JSON.stringify([{ id: dndId('hp'), value: 60 }]),
  ]);
  expect((await read()).combat.concentration!.checks).toHaveLength(1);
});
it('keeps six same-definition encounter creatures independent, including markers and concentration', async () => {
  const definition = emptyCombat();
  definition.concentration = {
    source: 'Definition spell',
    notes: 'Do not inherit active effects',
    checks: [],
  };
  await save(definition, 0, randomUUID(), enemy);
  const revision = (
    await db.query<{ revision: number }>('select revision from actors where id=$1', [enemy])
  ).rows[0].revision;
  await db.query('select create_encounter_creatures($1,$2,$3,6,$4,$5,null,null)', [
    game,
    scene,
    randomUUID(),
    enemy,
    revision,
  ]);
  const creatures = (
    await db.query<{ id: string; combat: Combat }>(
      'select id,combat from actors where encounter_instance order by id',
    )
  ).rows;
  expect(creatures).toHaveLength(6);
  for (const creature of creatures) expect(creature.combat).toEqual(emptyCombat());
  const state = emptyCombat();
  state.conditions = [
    { id: randomUUID(), name: 'Restrained', source: 'Net', notes: '', expiry: null, due: false },
  ];
  state.concentration = { source: 'Own spell', notes: '', checks: [] };
  await save(state, 0, randomUUID(), creatures[0].id);
  for (const creature of creatures.slice(1))
    expect((await read(creature.id)).combat).toEqual(emptyCombat());
  expect((await read(enemy)).combat).toEqual(definition);
});

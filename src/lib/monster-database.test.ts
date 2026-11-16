import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createMonsterSheet, srdMonsters, monsterHpId } from './srd-monsters';
import type { Sheet } from './types';

let db: PGlite;
const gm = randomUUID(),
  player = randomUUID(),
  stranger = randomUUID();
let game: string, scene: string, definition: string, foreignGame: string;
const sheet = createMonsterSheet('monster-aboleth');
async function as(user: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
}
async function mutate(command: string, payload: unknown = {}) {
  return (
    await db.query<{ value: Record<string, string> }>('select mutate_game($1,$2,$3::jsonb) value', [
      game,
      command,
      JSON.stringify(payload),
    ])
  ).rows[0].value;
}
async function add(
  operation = randomUUID(),
  count = 6,
  source: string | null = definition,
  revision: number | null = 0,
  targetScene = scene,
  targetGame = game,
) {
  return (
    await db.query<{ value: Record<string, string> }>(
      'select create_encounter_creatures($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value',
      [
        targetGame,
        targetScene,
        operation,
        count,
        source,
        revision,
        source ? null : 'Aboleth',
        source ? null : JSON.stringify(sheet),
      ],
    )
  ).rows[0].value;
}
async function actors() {
  return (
    await db.query<{
      id: string;
      name: string;
      sheet: Sheet;
      revision: number;
      appearance_revision: number;
      appearance_source_id: string | null;
      token_ring: string;
    }>('select * from actors where game_id=$1 and encounter_instance order by name', [game])
  ).rows;
}
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create publication supabase_realtime;
  `);
  const root = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(root)).sort())
    await db.exec(await readFile(new URL(file, root), 'utf8'));
  await db.query('insert into auth.users values ($1),($2),($3)', [gm, player, stranger]);
  await as(gm);
  game = (await db.query<{ id: string }>("select create_game('Monsters','GM') id")).rows[0].id;
  const invite = await mutate('invite');
  await as(player);
  await db.query("select accept_invite($1,'Player')", [invite.token]);
  await as(stranger);
  foreignGame = (await db.query<{ id: string }>("select create_game('Foreign','Other') id")).rows[0]
    .id;
  await db.exec('reset role');
  const map = randomUUID();
  await db.query(
    "insert into assets(id,game_id,owner_id,kind,path,width,height) values($1,$2,$3,'background','monsters.webp',400,300)",
    [map, game, gm],
  );
  await as(gm);
  scene = (await mutate('scene_create', { name: 'Encounter', asset_id: map })).id;
  // scene_create historically returns {}, so resolve it by its map.
  scene = (await db.query<{ id: string }>('select id from scenes where asset_id=$1', [map])).rows[0]
    .id;
  await mutate('scene_activate', { id: scene });
  definition = (
    await mutate('actor_create', { name: 'Aboleth', kind: 'enemy', owner_id: gm, sheet })
  ).id;
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe.sequential('independent encounter creatures', () => {
  it('accepts every generated sheet through Postgres validation', async () => {
    for (const monster of srdMonsters)
      expect(
        (
          await db.query<{ ok: boolean }>('select valid_sheet($1::jsonb) ok', [
            JSON.stringify(createMonsterSheet(monster.id)),
          ])
        ).rows[0].ok,
        monster.name,
      ).toBe(true);
  });
  it('creates six separately owned, hidden creatures atomically and retries exactly once', async () => {
    const operation = randomUUID();
    const result = await add(operation);
    expect(await add(operation)).toEqual(result);
    const rows = await actors();
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((a) => a.name)).size).toBe(6);
    expect((await db.query('select distinct hidden,controller_id from tokens')).rows).toEqual([
      { hidden: true, controller_id: gm },
    ]);
    await expect(add(operation, 5)).rejects.toThrow(/already used/);
    expect((await actors()).length).toBe(6);
  });
  it('adjusts only one creature and rejects stale concurrent damage; retries are idempotent', async () => {
    const [a, b] = await actors(),
      operation = randomUUID();
    const changes = JSON.stringify([{ id: monsterHpId, value: 138 }]);
    await db.query('select adjust_actor_resources($1,$2,0,$3,$4::jsonb)', [
      game,
      a.id,
      operation,
      changes,
    ]);
    await db.query('select adjust_actor_resources($1,$2,0,$3,$4::jsonb)', [
      game,
      a.id,
      operation,
      changes,
    ]);
    await expect(
      db.query('select adjust_actor_resources($1,$2,0,$3,$4::jsonb)', [
        game,
        a.id,
        randomUUID(),
        changes,
      ]),
    ).rejects.toThrow(/changed/);
    const rows = await actors();
    expect(
      rows
        .find((x) => x.id === a.id)!
        .sheet.sections.flatMap((s) => s.fields)
        .find((f) => f.id === monsterHpId)?.value,
    ).toBe(138);
    expect(rows.find((x) => x.id === b.id)!.sheet).toEqual(sheet);
  });
  it('does not propagate definition sheet edits or reinterpret legacy tokens', async () => {
    await db.query('select place_actor_token($1,$2,$3)', [game, definition, scene]);
    await db.query('select place_actor_token($1,$2,$3)', [game, definition, scene]);
    await mutate('actor_save', {
      id: definition,
      name: 'Changed aboleth',
      revision: 0,
      sheet: { version: 1, sections: [] },
    });
    expect((await actors())[1].sheet).toEqual(sheet);
    expect(
      (await db.query('select actor_id from tokens where actor_id=$1', [definition])).rows,
    ).toHaveLength(2);
    await expect(add()).rejects.toThrow(/changed/);
  });
  it('links definition appearance but allows independent overrides', async () => {
    const [a, b] = await actors();
    const portrait = randomUUID();
    await db.exec('reset role');
    await db.query(
      "insert into assets(id,game_id,owner_id,kind,path,width,height) values($1,$2,$3,'token',$4,100,100)",
      [portrait, game, gm, `monster-${portrait}.webp`],
    );
    await as(gm);
    await db.query("select save_actor_appearance($1,$2,$3,'ruby',0)", [game, definition, portrait]);
    expect((await actors()).every((x) => x.token_ring === 'ruby')).toBe(true);
    expect(
      (await db.query('select distinct asset_id from tokens where actor_id=$1', [b.id])).rows,
    ).toEqual([{ asset_id: portrait }]);
    await db.query("select save_actor_appearance($1,$2,$3,'emerald',1)", [game, a.id, portrait]);
    await db.query("select save_actor_appearance($1,$2,null,'sapphire',1)", [game, definition]);
    const rows = await actors();
    expect(rows.find((x) => x.id === a.id)).toMatchObject({
      token_ring: 'emerald',
      token_asset_id: portrait,
      appearance_source_id: null,
    });
    expect(rows.find((x) => x.id === b.id)).toMatchObject({
      token_ring: 'sapphire',
      token_asset_id: null,
      appearance_source_id: definition,
    });
  });
  it('duplicates current instance state without linking HP or granting inherited sheet access', async () => {
    const a = (await actors())[0];
    await mutate('grant', { actor_id: a.id, user_id: player, access: 'edit' });
    const result = await add(randomUUID(), 1, a.id, a.revision);
    expect((await actors()).find((x) => x.id === result.id)?.sheet).toEqual(a.sheet);
    expect(
      (await db.query('select * from sheet_grants where actor_id=$1', [result.id])).rows,
    ).toHaveLength(0);
  });
  it('hides sheets and tokens until separately revealed/granted; control alone never grants sheet access', async () => {
    const a = (await actors())[1];
    await as(player);
    expect((await db.query('select * from actors where id=$1', [a.id])).rows).toHaveLength(0);
    expect((await db.query('select * from tokens')).rows).toHaveLength(0);
    await expect(add()).rejects.toThrow(/GM required/);
    await as(gm);
    await mutate('scene_update', {
      id: scene,
      revision: 0,
      fog: [{ x: 0, y: 0, width: 400, height: 300, reveal: true }],
    });
    const t = (
      await db.query<{ id: string; revision: number }>(
        'select id,revision from tokens where actor_id=$1',
        [a.id],
      )
    ).rows[0];
    await mutate('token_update', {
      id: t.id,
      revision: t.revision,
      hidden: false,
      controller_id: player,
    });
    await as(player);
    expect((await db.query('select * from tokens where id=$1', [t.id])).rows).toHaveLength(1);
    expect((await db.query('select * from actors where id=$1', [a.id])).rows).toHaveLength(0);
    await as(gm);
    await mutate('grant', { actor_id: a.id, user_id: player, access: 'view' });
    await as(player);
    expect((await db.query('select * from actors where id=$1', [a.id])).rows).toHaveLength(1);
    await expect(
      db.query('select adjust_actor_resources($1,$2,$3,$4,$5::jsonb)', [
        game,
        a.id,
        a.revision,
        randomUUID(),
        JSON.stringify([{ id: monsterHpId, value: 1 }]),
      ]),
    ).rejects.toThrow(/denied/);
    await as(gm);
  });
  it('rejects invalid counts, foreign games/scenes/sources and PC duplication without partial writes', async () => {
    const count = (await actors()).length;
    await expect(add(randomUUID(), 21)).rejects.toThrow(/Invalid/);
    await expect(add(randomUUID(), 0)).rejects.toThrow(/Invalid/);
    await expect(add(randomUUID(), 2, definition, 1, randomUUID())).rejects.toThrow(/Scene/);
    await expect(add(randomUUID(), 2, randomUUID())).rejects.toThrow(/definition/);
    await expect(add(randomUUID(), 2, definition, 1, scene, foreignGame)).rejects.toThrow(
      /GM required/,
    );
    const pc = (
      await mutate('actor_create', {
        name: 'PC',
        kind: 'character',
        owner_id: player,
        sheet: { version: 1, sections: [] },
      })
    ).id;
    await expect(add(randomUUID(), 1, pc)).rejects.toThrow(/NPC or enemy/);
    expect((await actors()).length).toBe(count);
  });
  it('creates sourced library creatures without an actor definition', async () => {
    const result = await add(randomUUID(), 1, null);
    expect((await actors()).find((x) => x.id === result.id)?.sheet).toEqual(sheet);
  });
  it('source deletion preserves independent sheets, appearance and retry receipts', async () => {
    const operation = randomUUID();
    const result = await add(operation, 1, definition, 1);
    await db.query('select delete_actor($1,$2,1)', [game, definition]);
    expect((await actors()).find((x) => x.id === result.id)).toMatchObject({
      appearance_source_id: null,
    });
    expect(await add(operation, 1, definition, 1)).toEqual(result);
  });
  it('keeps six goblins independent after damage, including resource reload from the database', async () => {
    const goblin = createMonsterSheet('monster-goblin-warrior');
    await db.query('select create_encounter_creatures($1,$2,$3,6,null,null,$4,$5::jsonb)', [
      game,
      scene,
      randomUUID(),
      'Goblin',
      JSON.stringify(goblin),
    ]);
    const group = (await actors()).filter((a) => a.name.startsWith('Goblin '));
    expect(group).toHaveLength(6);
    await db.query('select adjust_actor_resources($1,$2,0,$3,$4::jsonb)', [
      game,
      group[0].id,
      randomUUID(),
      JSON.stringify([{ id: monsterHpId, value: 1 }]),
    ]);
    const reloaded = (await actors()).filter((a) => a.name.startsWith('Goblin '));
    expect(reloaded.find((a) => a.id === group[0].id)!.sheet).not.toEqual(goblin);
    for (const other of reloaded.filter((a) => a.id !== group[0].id))
      expect(other.sheet).toEqual(goblin);
  });
  it('denies receipt tables, raw writes, anonymous calls and receipt replay after GM role loss', async () => {
    const operation = randomUUID();
    await add(operation, 1, null);
    await expect(db.query('select * from creature_creation_receipts')).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query('update actors set encounter_instance=false')).rejects.toThrow(
      /permission denied/,
    );
    await as(stranger);
    await expect(add()).rejects.toThrow(/GM required/);
    await db.exec('reset role; set role anon');
    await expect(add()).rejects.toThrow(/permission denied/);
    await as(gm);
    await db.exec('reset role');
    await db.query('update games set gm_id=$1 where id=$2', [player, game]);
    await as(gm);
    await expect(add(operation, 1, null)).rejects.toThrow(/GM required/);
    await db.exec('reset role');
    await db.query('update games set gm_id=$1 where id=$2', [gm, game]);
    await as(gm);
  });
  it('rejects invalid new definitions atomically and keeps foreign-key cascades safe on game deletion', async () => {
    const before = (await actors()).length;
    await expect(
      db.query('select create_encounter_creatures($1,$2,$3,2,null,null,$4,$5::jsonb)', [
        game,
        scene,
        randomUUID(),
        'Invalid',
        JSON.stringify({ version: 1, sections: [], character: {} }),
      ]),
    ).rejects.toThrow(/Invalid creature definition/);
    expect((await actors()).length).toBe(before);
    const source = (
      await mutate('actor_create', { name: 'Cascade source', kind: 'npc', owner_id: gm, sheet })
    ).id;
    await add(randomUUID(), 2, source);
    await db.exec('reset role');
    await db.query('delete from games where id=$1', [game]);
    expect((await db.query('select id from actors where game_id=$1', [game])).rows).toHaveLength(0);
    expect(
      (await db.query('select * from creature_creation_receipts where game_id=$1', [game])).rows,
    ).toHaveLength(0);
  });
});

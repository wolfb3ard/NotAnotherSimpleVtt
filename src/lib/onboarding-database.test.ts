import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const gm = randomUUID(),
  player = randomUUID(),
  other = randomUUID();
let db: PGlite, game: string, scene: string, actor: string;
async function as(user: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
}
async function command(name: string, payload = {}) {
  return (
    await db.query<{ value: Record<string, string> }>(
      'select public.mutate_game($1,$2,$3::jsonb) as value',
      [game, name, JSON.stringify(payload)],
    )
  ).rows[0].value;
}
async function setup(name: string, payload: object, g = game) {
  return (
    await db.query<{ value: Record<string, string> }>(
      'select public.onboarding_command($1,$2,$3::jsonb) as value',
      [g, name, JSON.stringify(payload)],
    )
  ).rows[0].value;
}
async function revision() {
  return (await db.query<{ revision: number }>('select revision from scenes where id=$1', [scene]))
    .rows[0].revision;
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
  await db.query('insert into auth.users values ($1),($2),($3)', [gm, player, other]);
  await as(gm);
  game = (await db.query<{ id: string }>("select public.create_game('First session','GM') as id"))
    .rows[0].id;
  const invite = (await command('invite')).token;
  await as(player);
  await db.query("select public.accept_invite($1,'Player')", [invite]);
  await as(gm);
  actor = (
    await command('actor_create', {
      name: 'Hero',
      kind: 'character',
      owner_id: player,
      sheet: { version: 1, sections: [] },
    })
  ).id;
  const asset = randomUUID();
  await db.exec('reset role');
  await db.query(
    "insert into assets(id,game_id,owner_id,kind,path,width,height) values($1,$2,$3,'background',$4,600,400)",
    [asset, game, gm, `${asset}.webp`],
  );
  await as(gm);
  await command('scene_create', { name: 'Map', asset_id: asset });
  scene = (await db.query<{ id: string }>('select id from scenes where game_id=$1', [game])).rows[0]
    .id;
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe.sequential('guided placement authorization and persistence', () => {
  it('keeps fog edits distinct from actual calibration', async () => {
    expect((await db.query('select calibrated from scenes where id=$1', [scene])).rows[0]).toEqual({
      calibrated: false,
    });
    await command('scene_update', { id: scene, revision: 0, fog: [] });
    expect((await db.query('select calibrated from scenes where id=$1', [scene])).rows[0]).toEqual({
      calibrated: false,
    });
    await command('scene_update', { id: scene, revision: 1, units_per_pixel: 0.1, unit: 'ft' });
    expect((await db.query('select calibrated from scenes where id=$1', [scene])).rows[0]).toEqual({
      calibrated: true,
    });
  });
  it('requires GM authority and latest scene for private spawn writes', async () => {
    const request = { scene_id: scene, revision: await revision(), x: 320, y: 220 };
    await as(player);
    await expect(setup('party_spawn', request)).rejects.toThrow(/GM required/);
    await as(gm);
    await setup('party_spawn', request);
    await expect(setup('party_spawn', request)).rejects.toThrow(/Scene changed/);
    expect((await db.query('select x,y from party_spawns')).rows).toEqual([{ x: 320, y: 220 }]);
    await as(player);
    expect((await db.query('select * from party_spawns')).rows).toEqual([]);
    await expect(db.query('select * from placement_receipts')).rejects.toThrow(/permission denied/);
    await expect(
      db.query('insert into party_spawns values($1,$2,10,10)', [scene, game]),
    ).rejects.toThrow(/permission denied/);
  });
  it('confirms intentional default-valued calibration rather than treating it as missing setup', async () => {
    await as(gm);
    const request = {
      scene_id: scene,
      revision: await revision(),
      units_per_pixel: 1,
      unit: 'units',
    };
    await as(player);
    await expect(setup('scene_calibrate', request)).rejects.toThrow(/GM required/);
    await as(gm);
    await setup('scene_calibrate', request);
    expect(
      (await db.query('select calibrated,units_per_pixel,unit from scenes where id=$1', [scene]))
        .rows[0],
    ).toEqual({ calibrated: true, units_per_pixel: 1, unit: 'units' });
  });
  it('blocks concealed placement without leaking the spawn and places into revealed space', async () => {
    await as(player);
    const request = {
      scene_id: scene,
      actor_id: actor,
      revision: await revision(),
      operation_id: randomUUID(),
    };
    await expect(setup('token_place', request)).rejects.toThrow(/Placement unavailable/);
    await as(gm);
    await command('scene_update', {
      id: scene,
      revision: await revision(),
      fog: [{ x: 280, y: 180, width: 120, height: 120, reveal: true }],
    });
    await as(player);
    const retry = { ...request, revision: await revision() };
    expect(await setup('token_place', retry)).toEqual({ confirmed: 'true' });
    expect(
      (await db.query('select x,y,controller_id from tokens where actor_id=$1', [actor])).rows,
    ).toEqual([{ x: 320, y: 220, controller_id: player }]);
    // Receipt precedes the revision check: a lost-response retry survives newer fog.
    await as(gm);
    await command('scene_update', { id: scene, revision: await revision(), fog: [] });
    await as(player);
    expect(await setup('token_place', retry)).toEqual({ confirmed: 'true' });
    await expect(setup('token_place', { ...retry, x: 10, y: 10 })).rejects.toThrow(/already used/);
    expect((await db.query('select * from tokens')).rows).toEqual([]);
    await as(gm);
    expect((await db.query('select * from tokens where actor_id=$1', [actor])).rows).toHaveLength(
      1,
    );
  });
  it('checks bounds, owners, active scene, membership and stale placement', async () => {
    const request = {
      scene_id: scene,
      actor_id: actor,
      revision: await revision(),
      operation_id: randomUUID(),
      x: 600,
      y: 0,
    };
    await expect(setup('token_place', request)).rejects.toThrow(/outside/);
    await expect(setup('token_place', { ...request, x: 10, revision: -1 })).rejects.toThrow(
      /Scene changed/,
    );
    await expect(setup('token_place', { ...request, x: 10, y: null })).rejects.toThrow(/outside/);
    await expect(setup('token_place', { ...request, scene_id: randomUUID() })).rejects.toThrow(
      /Active scene/,
    );
    await as(other);
    await expect(setup('token_place', request)).rejects.toThrow(/access denied/);
    await as(gm);
    const privateActor = (
      await command('actor_create', {
        name: 'Private',
        kind: 'character',
        owner_id: gm,
        sheet: { version: 1, sections: [] },
      })
    ).id;
    await command('grant', { actor_id: privateActor, user_id: player, access: 'edit' });
    await as(player);
    await expect(
      setup('token_place', { ...request, actor_id: privateActor, x: 10 }),
    ).rejects.toThrow(/creation denied/);
    await db.exec('reset role; set role anon');
    await expect(setup('token_place', request)).rejects.toThrow(/permission denied/);
  });
  it('places GMs at explicit coordinates idempotently and transfers control only through GM authorization', async () => {
    await as(gm);
    const request = {
      scene_id: scene,
      actor_id: actor,
      revision: await revision(),
      operation_id: randomUUID(),
      x: 400,
      y: 300,
    };
    await setup('token_place', request);
    await setup('token_place', request);
    expect(
      (await db.query('select x,y from tokens where actor_id=$1 order by x', [actor])).rows,
    ).toEqual([
      { x: 320, y: 220 },
      { x: 400, y: 300 },
    ]);
    await as(player);
    await expect(
      db.query('select transfer_actor_owner($1,$2,$3,0)', [game, actor, gm]),
    ).rejects.toThrow(/GM required/);
    await as(gm);
    await db.query('select transfer_actor_owner($1,$2,$3,0)', [game, actor, gm]);
    expect(
      (await db.query('select distinct controller_id from tokens where actor_id=$1', [actor])).rows,
    ).toEqual([{ controller_id: gm }]);
    await as(player);
    await expect(setup('token_place', { ...request, operation_id: randomUUID() })).rejects.toThrow(
      /creation denied/,
    );
    expect((await db.query('select * from actors where id=$1', [actor])).rows).toEqual([]);
  });
  it('uses center fallback in a new scene and never exposes other-scene placements', async () => {
    await as(gm);
    const asset = (
      await db.query<{ asset_id: string }>('select asset_id from scenes where id=$1', [scene])
    ).rows[0].asset_id;
    await command('scene_create', { name: 'Second map', asset_id: asset });
    const second = (
      await db.query<{ id: string }>('select id from scenes where game_id=$1 and id<>$2', [
        game,
        scene,
      ])
    ).rows[0].id;
    const hero = (
      await command('actor_create', {
        name: 'New hero',
        kind: 'character',
        owner_id: player,
        sheet: { version: 1, sections: [] },
      })
    ).id;
    await command('scene_activate', { id: second });
    await command('scene_update', {
      id: second,
      revision: 0,
      fog: [{ x: 0, y: 0, width: 600, height: 400, reveal: true }],
    });
    const request = { scene_id: second, actor_id: hero, revision: 1, operation_id: randomUUID() };
    await as(player);
    await setup('token_place', request);
    await setup('token_place', { ...request, operation_id: randomUUID() });
    expect((await db.query('select x,y from tokens where actor_id=$1', [hero])).rows).toEqual([
      { x: 300, y: 200 },
    ]);
    await as(gm);
    await command('scene_activate', { id: scene });
    await as(player);
    expect((await db.query('select * from tokens where actor_id=$1', [hero])).rows).toEqual([]);
    await expect(setup('token_place', { ...request, operation_id: randomUUID() })).rejects.toThrow(
      /Active scene changed/,
    );
    // A receipt acknowledges only the caller's prior operation, never a location.
    expect(await setup('token_place', request)).toEqual({ confirmed: 'true' });
  });
});

describe.sequential('shared grid authorization and concurrency', () => {
  const grid = { enabled: true, size: 50, origin_x: 10, origin_y: 20 };
  const configure = async (p: object, g = game) =>
    (
      await db.query<{ value: object }>(
        'select public.configure_scene_grid($1,$2::jsonb) as value',
        [g, JSON.stringify(p)],
      )
    ).rows[0].value;
  it('defaults old/new maps to a disabled grid without touching calibration or tokens', async () => {
    await as(gm);
    const rows = (
      await db.query<{ grid: typeof grid }>('select grid from scenes where game_id=$1', [game])
    ).rows;
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect(row.grid).toEqual({ enabled: false, size: 50, origin_x: 0, origin_y: 0 });
  });
  it('requires current GM membership, rejects anonymous/outsider/direct writes', async () => {
    const p = { scene_id: scene, revision: await revision(), operation_id: randomUUID(), grid };
    await as(player);
    await expect(configure(p)).rejects.toThrow(/GM required/);
    await expect(
      db.query('update scenes set grid=$1 where id=$2', [JSON.stringify(grid), scene]),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query('select * from grid_receipts')).rejects.toThrow(/permission denied/);
    await as(other);
    await expect(configure(p)).rejects.toThrow(/access denied/);
    await db.exec('reset role; set role anon');
    await expect(configure(p)).rejects.toThrow(/permission denied/);
  });
  it('commits once, permits exact retries after newer writes, and rejects conflicting retries/stale editors', async () => {
    await as(gm);
    const p = { scene_id: scene, revision: await revision(), operation_id: randomUUID(), grid };
    expect(await configure(p)).toEqual({ confirmed: 'true' });
    expect(await revision()).toBe(p.revision + 1);
    await expect(configure({ ...p, operation_id: randomUUID() })).rejects.toThrow(/Scene changed/);
    await configure({
      ...p,
      revision: await revision(),
      operation_id: randomUUID(),
      grid: { ...grid, size: 60 },
    });
    expect(await configure(p)).toEqual({ confirmed: 'true' });
    expect(await revision()).toBe(p.revision + 2);
    await expect(configure({ ...p, grid: { ...grid, size: 70 } })).rejects.toThrow(/already used/);
    await as(player);
    expect(
      (await db.query<{ grid: typeof grid }>('select grid from scenes where id=$1', [scene]))
        .rows[0].grid,
    ).toEqual({
      ...grid,
      size: 60,
    });
    await as(gm);
  });
  it('rejects malformed/oversized grids at the database boundary atomically', async () => {
    const rev = await revision();
    for (const invalid of [
      null,
      {},
      { ...grid, size: 0 },
      { ...grid, origin_x: -1 },
      { ...grid, enabled: 'true' },
      { ...grid, secret: true },
      { ...grid, size: 1025 },
    ]) {
      await expect(
        configure({ scene_id: scene, revision: rev, operation_id: randomUUID(), grid: invalid }),
      ).rejects.toThrow();
      expect(await revision()).toBe(rev);
    }
  });
  it('rejects inactive/cross-game scenes and reconciles prior receipts without exposing coordinates', async () => {
    const rev = await revision();
    const p = { scene_id: scene, revision: rev, operation_id: randomUUID(), grid };
    await configure(p);
    const second = (
      await db.query<{ id: string }>('select id from scenes where game_id=$1 and id<>$2', [
        game,
        scene,
      ])
    ).rows[0].id;
    await command('scene_activate', { id: second });
    await expect(
      configure({ ...p, revision: rev + 1, operation_id: randomUUID() }),
    ).rejects.toThrow(/Active scene changed/);
    expect(await configure(p)).toEqual({ confirmed: 'true' });
    const foreign = (
      await db.query<{ id: string }>("select public.create_game('Other','GM') as id")
    ).rows[0].id;
    await expect(configure({ ...p, operation_id: randomUUID() }, foreign)).rejects.toThrow(
      /Active scene changed/,
    );
    await command('scene_activate', { id: scene });
  });
  it('keeps existing token movement free and undoable on a calibrated grid', async () => {
    const token = (
      await db.query<{ id: string; revision: number; x: number; y: number }>(
        'select id,revision,x,y from tokens where scene_id=$1 limit 1',
        [scene],
      )
    ).rows[0];
    const operation_id = randomUUID();
    const invoke = (name: string, p: object) =>
      db.query('select public.tabletop_command($1,$2,$3::jsonb)', [game, name, JSON.stringify(p)]);
    await invoke('tabletop_move', {
      scene_id: scene,
      operation_id,
      id: token.id,
      revision: token.revision,
      x: 123.4,
      y: 234.5,
    });
    expect((await db.query('select x,y from tokens where id=$1', [token.id])).rows).toEqual([
      { x: 123.4, y: 234.5 },
    ]);
    await invoke('tabletop_undo', { scene_id: scene, operation_id });
    expect((await db.query('select x,y from tokens where id=$1', [token.id])).rows).toEqual([
      { x: token.x, y: token.y },
    ]);
  });
});

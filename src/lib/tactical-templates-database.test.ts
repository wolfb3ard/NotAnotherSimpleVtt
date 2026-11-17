import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SharedArea } from './tactical-templates';

const gm = randomUUID(),
  player = randomUUID(),
  other = randomUUID(),
  outsider = randomUUID();
let db: PGlite, game: string, scene: string;
const area = { kind: 'circle', x: 100, y: 100, size: 20, width: 5, rotation: 0 };
async function as(user: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
}
async function command(name: string, payload = {}) {
  return (
    await db.query<{ value: Record<string, string> }>('select mutate_game($1,$2,$3::jsonb) value', [
      game,
      name,
      JSON.stringify(payload),
    ])
  ).rows[0].value;
}
function request(change = {}) {
  return {
    scene_id: scene,
    scene_revision: 1,
    owner_id: player,
    revision: 0,
    operation_id: randomUUID(),
    area,
    ...change,
  };
}
async function write(p: ReturnType<typeof request>) {
  return (
    await db.query<{ value: { confirmed: string } }>(
      'select tactical_template_command($1,$2::jsonb) value',
      [game, JSON.stringify(p)],
    )
  ).rows[0].value;
}
async function read() {
  return (
    await db.query<{ value: SharedArea[] }>('select tactical_template_snapshot($1) value', [game])
  ).rows[0].value;
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
  await db.query('insert into auth.users values($1),($2),($3),($4)', [gm, player, other, outsider]);
  await as(gm);
  game = (await db.query<{ id: string }>("select create_game('Templates','GM') id")).rows[0].id;
  const invite = (await command('invite')).token;
  for (const user of [player, other]) {
    await as(user);
    await db.query("select accept_invite($1,'Player')", [invite]);
  }
  await db.exec('reset role');
  const asset = randomUUID();
  await db.query(
    "insert into assets(id,game_id,owner_id,kind,path,width,height) values($1,$2,$3,'background',$4,600,400)",
    [asset, game, gm, `${asset}.webp`],
  );
  await as(gm);
  await command('scene_create', { name: 'Map', asset_id: asset });
  scene = (await db.query<{ id: string }>('select id from scenes where game_id=$1', [game])).rows[0]
    .id;
  await command('scene_update', {
    id: scene,
    revision: 0,
    fog: [{ x: 50, y: 50, width: 200, height: 200, reveal: true }],
  });
  await db.exec('reset role');
  await db.query("update scenes set calibrated=true,units_per_pixel=0.1,unit='ft' where id=$1", [
    scene,
  ]);
  await as(player);
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe.sequential('server-authoritative shared templates', () => {
  it('denies outsiders, anonymous callers and direct table access', async () => {
    await as(outsider);
    await expect(read()).rejects.toThrow(/access denied/);
    await expect(write(request())).rejects.toThrow(/access denied/);
    await as(player);
    for (const table of ['tactical_templates', 'tactical_template_receipts']) {
      await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`delete from ${table}`)).rejects.toThrow(/permission denied/);
    }
    await db.exec('reset role; set role anon');
    await expect(read()).rejects.toThrow(/permission denied/);
    await expect(write(request())).rejects.toThrow(/permission denied/);
  });
  it('rejects invalid geometry, concealed origins, stale scene and other scenes', async () => {
    await db.exec('reset role');
    await db.query('update scenes set calibrated=false where id=$1', [scene]);
    await as(player);
    await expect(write(request())).rejects.toThrow(/Calibrate/);
    await db.exec('reset role');
    await db.query('update scenes set calibrated=true where id=$1', [scene]);
    await as(player);
    for (const change of [
      { size: 0 },
      { kind: 'sphere' },
      { x: 600 },
      { y: -1 },
      { rotation: 361 },
      { width: null },
      { x: 'NaN' },
    ])
      await expect(write(request({ area: { ...area, ...change } }))).rejects.toThrow();
    await expect(write(request({ area: { ...area, x: 10 } }))).rejects.toThrow(/revealed/);
    await expect(write(request({ scene_revision: 0 }))).rejects.toThrow(/Scene changed/);
    await expect(write(request({ scene_id: randomUUID() }))).rejects.toThrow(/Active scene/);
    await expect(write(request({ owner_id: other }))).rejects.toThrow(/owner or GM/);
  });
  it('shares explicitly, preserves owner, deduplicates exact retries and rejects stale concurrent moves', async () => {
    const p = request();
    expect(await write(p)).toEqual({ confirmed: 'true' });
    expect(await write(p)).toEqual({ confirmed: 'true' });
    await expect(write({ ...p, area: { ...area, size: 30 } })).rejects.toThrow(/Operation already/);
    await expect(write(request())).rejects.toThrow(/Template changed/);
    await as(other);
    expect((await read())[0]).toMatchObject({ owner_id: player, revision: 1, area });
    await expect(write(request({ revision: 1 }))).rejects.toThrow(/owner or GM/);
    await as(gm);
    expect(
      await write(request({ revision: 1, area: { ...area, kind: 'line', x: 120, rotation: 90 } })),
    ).toEqual({ confirmed: 'true' });
    expect((await read())[0]).toMatchObject({
      owner_id: player,
      revision: 2,
      area: { kind: 'line', x: 120 },
    });
  });
  it('supports independent slots and owner/GM dismissal without stale retry resurrection', async () => {
    await as(other);
    await write(request({ owner_id: other, area: { ...area, kind: 'cube' } }));
    expect(await read()).toHaveLength(2);
    await as(player);
    const remove = request({ revision: 2, area: null });
    await write(remove);
    expect((await read()).find((t) => t.owner_id === player)).toMatchObject({
      revision: 3,
      area: null,
    });
    await write(request({ revision: 3, area: { ...area, kind: 'cone' } }));
    await write(remove);
    expect((await read()).find((t) => t.owner_id === player)?.area?.kind).toBe('cone');
    await as(gm);
    await write(request({ revision: 4, area: null }));
    expect((await read()).map((t) => t.owner_id)).toEqual([other]);
  });
  it('revalidates fog/revisions for every reader, including GM, and never exposes old geometry', async () => {
    await as(gm);
    await command('scene_update', { id: scene, revision: 1, fog: [] });
    expect(await read()).toEqual([]);
    await as(other);
    expect(await read()).toEqual([
      { owner_id: other, scene_id: scene, scene_revision: 2, revision: 1, area: null },
    ]);
    await as(gm);
    await expect(write(request({ owner_id: gm, scene_revision: 2 }))).rejects.toThrow(/revealed/);
    await command('scene_update', {
      id: scene,
      revision: 2,
      fog: [{ x: 0, y: 0, width: 600, height: 400, reveal: true }],
    });
    expect(await read()).toEqual([]);
    await as(other);
    await write(request({ owner_id: other, scene_revision: 3, revision: 1 }));
  });
  it('filters inactive scenes, reconciles on reconnect and denies revoked membership', async () => {
    await db.exec('reset role');
    await db.query('update games set active_scene_id=null where id=$1', [game]);
    await as(other);
    expect(await read()).toEqual([]);
    await expect(
      write(request({ owner_id: other, scene_revision: 3, revision: 2 })),
    ).rejects.toThrow(/Active scene/);
    await db.exec('reset role');
    await db.query('update games set active_scene_id=$1 where id=$2', [scene, game]);
    await as(player);
    expect((await read()).some((t) => t.owner_id === other && t.area)).toBe(true);
    await db.exec('reset role');
    await db.query('delete from memberships where game_id=$1 and user_id=$2', [game, other]);
    await as(other);
    await expect(read()).rejects.toThrow(/access denied/);
    await expect(write(request({ owner_id: other }))).rejects.toThrow(/access denied/);
    await as(player);
    expect((await read()).some((t) => t.owner_id === other)).toBe(false);
  });
});

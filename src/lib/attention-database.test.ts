import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const gm = randomUUID(),
  player = randomUUID(),
  outsider = randomUUID();
let db: PGlite, game: string, scene: string;
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
async function signal(kind = 'ping', x = 100, y = 100, revision = 1, target = scene) {
  return db.query('select send_attention($1,$2,$3,$4,$5,$6)', [game, target, revision, kind, x, y]);
}
async function pulse(tab = randomUUID(), live = true) {
  return (
    await db.query<{
      value: { members: { user_id: string; live: boolean; tabs: number }[]; signals: unknown[] };
    }>('select room_pulse($1,$2,$3) value', [game, tab, live])
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
  await db.query('insert into auth.users values($1),($2),($3)', [gm, player, outsider]);
  await as(gm);
  game = (await db.query<{ id: string }>("select create_game('Attention','GM') id")).rows[0].id;
  const invite = (await command('invite')).token;
  await as(player);
  await db.query("select accept_invite($1,'Player')", [invite]);
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
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe.sequential('ephemeral shared attention', () => {
  it('denies outsiders, anonymous callers and direct table access', async () => {
    await as(outsider);
    await expect(pulse()).rejects.toThrow(/access denied/);
    await expect(signal()).rejects.toThrow(/access denied/);
    await as(player);
    for (const table of ['room_leases', 'attention_signals']) {
      await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`delete from ${table}`)).rejects.toThrow(/permission denied/);
    }
    await db.exec('reset role; set role anon');
    await expect(pulse()).rejects.toThrow(/permission denied/);
    await expect(signal()).rejects.toThrow(/permission denied/);
  });
  it('aggregates live tabs without treating membership as online; expires leases', async () => {
    await as(player);
    const tab1 = randomUUID(),
      tab2 = randomUUID();
    expect((await pulse(tab1, false)).members).toEqual([{ user_id: player, live: false, tabs: 1 }]);
    expect((await pulse(tab2)).members).toEqual([{ user_id: player, live: true, tabs: 2 }]);
    await db.exec('reset role');
    await db.query(
      "update room_leases set seen_at=clock_timestamp()-interval '30 seconds' where tab_id=$1",
      [tab2],
    );
    await as(player);
    expect((await pulse(tab1, false)).members).toEqual([{ user_id: player, live: false, tabs: 1 }]);
  });
  it('bounds tab growth and uses authenticated identity', async () => {
    for (let i = 0; i < 7; i++) await pulse();
    await expect(pulse()).rejects.toThrow(/Too many tabs/);
    await db.exec('reset role');
    await db.query('delete from room_leases where game_id=$1', [game]);
    await as(player);
  });
  it('allows revealed pings but not player camera requests, hidden space or stale/other scenes', async () => {
    await expect(signal('camera')).rejects.toThrow(/GM required/);
    await expect(signal('ping', 10, 10)).rejects.toThrow(/Target unavailable/);
    await expect(signal('ping', 600, 100)).rejects.toThrow(/Target unavailable/);
    await expect(signal('ping', NaN, 100)).rejects.toThrow(/Target unavailable/);
    await expect(signal('ping', 100, 100, 0)).rejects.toThrow(/Target unavailable/);
    await expect(signal('ping', 100, 100, 1, randomUUID())).rejects.toThrow(/Target unavailable/);
    await expect(signal('other')).rejects.toThrow(/Invalid attention/);
    await signal();
    expect((await pulse()).signals).toHaveLength(1);
  });
  it('throttles per identity across tabs and bounds retained signals', async () => {
    await expect(signal()).rejects.toThrow(/Slow down/);
    await db.exec('reset role');
    await db.query(
      "update attention_signals set created_at=clock_timestamp()-interval '3 seconds'",
    );
    await as(player);
    await signal('ping', 120, 120);
    expect((await pulse()).signals).toHaveLength(1);
  });
  it('requires revealed space even for GM and never reads token locations', async () => {
    await as(gm);
    await expect(signal('camera', 10, 10)).rejects.toThrow(/Target unavailable/);
    await signal('camera', 100, 100);
    await as(player);
    expect((await pulse()).signals).toHaveLength(2);
  });
  it('filters against current fog/revision, scene switches, membership and expiry at read time', async () => {
    await as(gm);
    await command('scene_update', { id: scene, revision: 1, fog: [] });
    await as(player);
    expect((await pulse()).signals).toEqual([]);
    await as(gm);
    await command('scene_update', {
      id: scene,
      revision: 2,
      fog: [{ x: 0, y: 0, width: 600, height: 400, reveal: true }],
    });
    expect((await pulse()).signals).toEqual([]);
    await db.exec('reset role');
    await db.query(
      "update attention_signals set created_at=clock_timestamp()-interval '30 seconds'",
    );
    await as(gm);
    await signal('camera', 100, 100, 3);
    await db.exec('reset role');
    await db.query('update games set active_scene_id=null where id=$1', [game]);
    await as(player);
    expect((await pulse()).signals).toEqual([]);
    await db.exec('reset role');
    await db.query('update games set active_scene_id=$1 where id=$2', [scene, game]);
    await as(player);
    expect((await pulse()).signals).toEqual([]);
    await as(gm);
    await signal('camera', 100, 100, 3);
    expect((await pulse()).signals).toHaveLength(1);
    await db.exec('reset role');
    await db.query(
      "update attention_signals set created_at=clock_timestamp()-interval '30 seconds'",
    );
    await as(player);
    expect((await pulse()).signals).toEqual([]);
  });
  it('removes leases/signals on membership revocation and rejects subsequent requests', async () => {
    await db.exec('reset role');
    await db.query('delete from memberships where game_id=$1 and user_id=$2', [game, player]);
    await as(player);
    await expect(pulse()).rejects.toThrow(/access denied/);
    await expect(signal('ping', 100, 100, 3)).rejects.toThrow(/access denied/);
    await as(gm);
    expect((await pulse()).members.some((m) => m.user_id === player)).toBe(false);
  });
});

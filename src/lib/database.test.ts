import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

const gm = randomUUID(),
  player = randomUUID(),
  other = randomUUID();
const sheet = { version: 1, sections: [] };
let db: PGlite;
let game: string, otherGame: string, actor: string, scene: string, token: string, invite: string;
async function as(user: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
}
async function command(name: string, payload = {}, gameId = game) {
  const result = await db.query<{ value: Record<string, string> }>(
    'select public.mutate_game($1,$2,$3::jsonb) as value',
    [gameId, name, JSON.stringify(payload)],
  );
  return result.rows[0].value;
}
async function count(table: string) {
  return (await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0]
    .n;
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
  game = (await db.query<{ id: string }>("select public.create_game('Coast','GM') as id")).rows[0]
    .id;
  invite = (await command('invite')).token;
  await as(player);
  await db.query("select public.accept_invite($1,'Player')", [invite]);
  await as(other);
  otherGame = (
    await db.query<{ id: string }>("select public.create_game('Other','Other GM') as id")
  ).rows[0].id;
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe.sequential('database authorization and transactions', () => {
  it('scopes roles and isolates unrelated games', async () => {
    await as(player);
    expect(await count('games')).toBe(1);
    await expect(command('dice', { dice: [6] })).rejects.toThrow(/GM required/);
    await expect(command('invite', {}, otherGame)).rejects.toThrow(/denied/);
    await expect(
      db.query('update public.games set gm_id=$1 where id=$2', [player, game]),
    ).rejects.toThrow(/permission denied/);
    const own = (
      await db.query<{ id: string }>("select public.create_game('My game','Player as GM') as id")
    ).rows[0].id;
    expect(own).not.toBe(game);
    expect(await count('games')).toBe(2);
  });
  it('accepts invitations idempotently and rejects revoked and expired links', async () => {
    await as(player);
    await db.query("select public.accept_invite($1,'Player')", [invite]);
    expect(
      (
        await db.query<{ n: number }>(
          'select count(*)::int as n from memberships where game_id=$1',
          [game],
        )
      ).rows[0].n,
    ).toBe(2);
    await as(gm);
    await command('revoke_invites');
    await as(other);
    await expect(db.query("select public.accept_invite($1,'Other')", [invite])).rejects.toThrow(
      /invalid/,
    );
    await as(gm);
    const expiring = (await command('invite')).token;
    await db.exec('reset role');
    await db.query("update invitations set expires_at=now()-interval '1 minute' where game_id=$1", [
      game,
    ]);
    await as(other);
    await expect(db.query("select public.accept_invite($1,'Other')", [expiring])).rejects.toThrow(
      /invalid/,
    );
  });
  it('enforces actor ownership, sheet grants, and stale revision protection', async () => {
    await as(gm);
    actor = (await command('actor_create', { name: 'Enemy', kind: 'enemy', owner_id: gm, sheet }))
      .id;
    await as(player);
    expect(await count('actors')).toBe(0);
    await expect(
      command('actor_save', { id: actor, name: 'Hacked', sheet, revision: 0 }),
    ).rejects.toThrow(/denied/);
    await expect(
      command('actor_create', { name: 'Enemy', kind: 'enemy', owner_id: player, sheet }),
    ).rejects.toThrow();
    await as(gm);
    await command('grant', { actor_id: actor, user_id: player, access: 'view' });
    await as(player);
    expect(await count('actors')).toBe(1);
    await expect(
      command('actor_save', { id: actor, name: 'No', sheet, revision: 0 }),
    ).rejects.toThrow(/denied/);
    await as(gm);
    await command('grant', { actor_id: actor, user_id: player, access: 'edit' });
    await as(player);
    await command('actor_save', { id: actor, name: 'Updated', sheet, revision: 0 });
    await expect(
      command('actor_save', { id: actor, name: 'Stale', sheet, revision: 0 }),
    ).rejects.toThrow(/changed/);
    await as(gm);
    await command('grant', { actor_id: actor, user_id: player, access: 'none' });
    await as(player);
    expect(await count('actors')).toBe(0);
  });
  it('rejects malformed sheet content through direct RPC calls', async () => {
    await as(gm);
    await expect(
      command('actor_save', {
        id: actor,
        name: 'Broken',
        sheet: { version: 1, sections: 'invalid' },
        revision: 1,
      }),
    ).rejects.toThrow(/actors_valid_sheet/);
  });
  it('hides fogged and explicitly hidden tokens and protects original map assets', async () => {
    const asset = randomUUID();
    await db.exec('reset role');
    await db.query(
      "insert into assets(id,game_id,owner_id,kind,path,width,height) values($1,$2,$3,'background','map.webp',200,200)",
      [asset, game, gm],
    );
    await as(gm);
    await command('scene_create', { name: 'Forest', asset_id: asset });
    scene = (await db.query<{ id: string }>('select id from scenes where game_id=$1', [game]))
      .rows[0].id;
    await command('token_create', { actor_id: actor, scene_id: scene, asset_id: null });
    token = (await db.query<{ id: string }>('select id from tokens where game_id=$1', [game]))
      .rows[0].id;
    await as(player);
    expect(await count('tokens')).toBe(0);
    expect(await count('assets')).toBe(0);
    await as(gm);
    await command('scene_update', {
      id: scene,
      revision: 0,
      fog: [{ x: 0, y: 0, width: 200, height: 200, reveal: true }],
    });
    await as(player);
    expect(await count('tokens')).toBe(1);
    await expect(command('token_update', { id: token, revision: 0, x: 10, y: 10 })).rejects.toThrow(
      /denied/,
    );
    await as(gm);
    await command('token_update', { id: token, revision: 0, hidden: true });
    await as(player);
    expect(await count('tokens')).toBe(0);
    await as(gm);
    await command('token_update', { id: token, revision: 1, hidden: false, controller_id: player });
    await as(player);
    await command('token_update', { id: token, revision: 2, x: 20, y: 30 });
    await expect(command('token_update', { id: token, revision: 3, hidden: true })).rejects.toThrow(
      /GM required/,
    );
    await as(gm);
    await command('scene_update', {
      id: scene,
      revision: 1,
      fog: [{ x: 0, y: 0, width: 50, height: 50, reveal: true }],
    });
    await as(player);
    await expect(command('token_update', { id: token, revision: 3, x: 70, y: 70 })).rejects.toThrow(
      /concealed/,
    );
  });
  it('blocks cross-game references and GM impersonation', async () => {
    await as(other);
    await expect(command('scene_activate', { id: scene }, otherGame)).rejects.toThrow();
    await expect(
      command('token_create', { actor_id: actor, scene_id: scene, asset_id: null }, otherGame),
    ).rejects.toThrow();
    expect(await count('tokens')).toBe(0);
  });
  it('allows only server-generated rolls and filters private results', async () => {
    const publicId = randomUUID();
    const outcome = {
      total: 3,
      dice: [{ sides: 6, values: [3], kept: [true], total: 3 }],
      resolvedExpression: '1d6',
      modifiers: {},
    };
    await as(player);
    await expect(
      db.query("select record_roll($1,$2,$3,null,'1d6','public',$4)", [
        player,
        game,
        publicId,
        outcome,
      ]),
    ).rejects.toThrow(/permission denied/);
    await db.exec('reset role; set role service_role');
    await db.query("select record_roll($1,$2,$3,null,'1d6','public',$4)", [
      player,
      game,
      publicId,
      outcome,
    ]);
    await db.query("select record_roll($1,$2,$3,null,'1d6','public',$4)", [
      player,
      game,
      publicId,
      outcome,
    ]);
    await db.query("select record_roll($1,$2,$3,null,'1d6','private',$4)", [
      player,
      game,
      randomUUID(),
      outcome,
    ]);
    await db.query("select record_roll($1,$2,$3,null,'1d6','private',$4)", [
      gm,
      game,
      randomUUID(),
      outcome,
    ]);
    await as(gm);
    expect(await count('rolls')).toBe(3);
    await as(player);
    expect(await count('rolls')).toBe(2);
    const viewer = randomUUID();
    await db.exec('reset role');
    await db.query('insert into auth.users values($1)', [viewer]);
    await as(gm);
    const viewerInvite = (await command('invite')).token;
    await as(viewer);
    await db.query("select accept_invite($1,'Second player')", [viewerInvite]);
    expect(await count('rolls')).toBe(1);
    await as(other);
    expect(await count('rolls')).toBe(0);
    await db.exec('reset role; set role service_role');
    await expect(
      db.query("select record_roll($1,$2,$3,null,'1d6','public',$4)", [
        other,
        game,
        randomUUID(),
        outcome,
      ]),
    ).rejects.toThrow(/denied/);
  });
  it('copies creator-owned templates into another membership without permissions', async () => {
    await as(gm);
    await command('template_create', { actor_id: actor, name: 'Monster' });
    const template = (
      await db.query<{ id: string }>('select id from templates where game_id=$1', [game])
    ).rows[0].id;
    await as(player);
    await expect(command('template_copy', { id: template })).rejects.toThrow(/Only your/);
    await as(gm);
    const destination = (await db.query<{ id: string }>("select create_game('Next','GM') as id"))
      .rows[0].id;
    await command('template_copy', { id: template }, destination);
    expect(
      (
        await db.query<{ n: number }>('select count(*)::int as n from templates where game_id=$1', [
          destination,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
  it('shows anonymous private player cues without private GM cues or values', async () => {
    await as(gm);
    const cues = await db.query<{ roll_id: string; private: boolean }>(
      'select roll_id, private from public.roll_cues where game_id=$1',
      [game],
    );
    expect(cues.rows.filter((cue) => cue.private)).toHaveLength(1);
    await as(player);
    expect(
      (await db.query('select * from public.roll_cues where game_id=$1', [game])).rows,
    ).toHaveLength(2);
    await as(other);
    expect(
      (await db.query('select * from public.roll_cues where game_id=$1', [game])).rows,
    ).toHaveLength(0);
    await as(player);
    await expect(
      db.query('insert into public.roll_cues(game_id,roll_id,private) values($1,$2,true)', [
        game,
        randomUUID(),
      ]),
    ).rejects.toThrow(/permission denied/);
  });
  it('stores bounded per-user appearance without cross-user writes', async () => {
    const style = {
      faceColor: '#123456',
      numberColor: '#ffffff',
      outlineColor: '#000000',
      opacity: 0.75,
      glossiness: 0.5,
      shimmer: 0.25,
    };
    await as(player);
    await db.query('select public.save_dice_style($1::jsonb)', [JSON.stringify(style)]);
    await as(gm);
    expect(
      (
        await db.query<{ style: typeof style }>(
          'select style from public.dice_styles where user_id=$1',
          [player],
        )
      ).rows[0].style,
    ).toEqual(style);
    await expect(
      db.query('update public.dice_styles set user_id=$1 where user_id=$2', [gm, player]),
    ).rejects.toThrow(/permission denied/);
    await as(player);
    await expect(
      db.query('select public.save_dice_style($1::jsonb)', [
        JSON.stringify({ ...style, opacity: 3 }),
      ]),
    ).rejects.toThrow(/Invalid dice style/);
  });
});

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDndSheet, dndId } from './dnd';
import { numericFields, sheetSchema } from './sheets';
import type { Sheet } from './types';
import { emptyCharacterDetails } from './character-details';
import { applySrdBuilder } from './srd-engine';
import { classBuilder, fighterBuilder, multiclassBuilder } from './srd-test-fixtures';
import { srdClasses } from './srd-rules';

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

function persistentActorTests() {
  describe.sequential('persistent actor tokens', () => {
    let hero: string, portrait: string, secondScene: string;
    const appearance = (id: string, asset: string | null, ring = 'ruby', revision = 0, g = game) =>
      db.query('select public.save_actor_appearance($1,$2,$3,$4,$5)', [
        g,
        id,
        asset,
        ring,
        revision,
      ]);
    const place = (id: string, s = scene, g = game) =>
      db.query('select public.place_actor_token($1,$2,$3)', [g, id, s]);

    it('stores appearance independently of sheet revision and authorizes portraits before placement', async () => {
      portrait = randomUUID();
      const map = randomUUID();
      await db.exec('reset role');
      await db.query(
        "insert into assets(id,game_id,owner_id,kind,path,width,height) values($1,$2,$3,'token',$4,100,200),($5,$2,$3,'background',$6,200,200)",
        [portrait, game, gm, `portrait-${portrait}.webp`, map, `map-${map}.webp`],
      );
      await as(gm);
      await command('scene_create', { name: 'Second scene', asset_id: map });
      secondScene = (
        await db.query<{ id: string }>('select id from scenes where asset_id=$1', [map])
      ).rows[0].id;
      hero = (
        await command('actor_create', {
          name: 'Persistent hero',
          kind: 'character',
          owner_id: player,
          sheet,
        })
      ).id;
      await appearance(hero, portrait, 'ruby');
      await as(player);
      expect((await db.query('select id from assets where id=$1', [portrait])).rows).toHaveLength(
        1,
      );
      expect(
        (
          await db.query('select revision,appearance_revision,token_ring from actors where id=$1', [
            hero,
          ])
        ).rows[0],
      ).toEqual({ revision: 0, appearance_revision: 1, token_ring: 'ruby' });
      // A GM-supplied portrait remains usable when its owner changes just the ring.
      await appearance(hero, portrait, 'emerald', 1);
      await expect(appearance(hero, null, 'silver', 1)).rejects.toThrow(/changed/);
      await expect(appearance(hero, null, 'invalid', 2)).rejects.toThrow(/Invalid token ring/);
      await expect(appearance(hero, null, 'gold', null as unknown as number)).rejects.toThrow(
        /changed/,
      );
    });

    it('places an owned actor in active scenes with canonical appearance and live sheet stats', async () => {
      await as(gm);
      await command('scene_activate', { id: scene });
      await as(player);
      await place(hero);
      await place(hero);
      await as(gm);
      let rows = (
        await db.query(
          'select actor_id,asset_id,ring,controller_id from tokens where actor_id=$1',
          [hero],
        )
      ).rows;
      expect(rows).toEqual([
        { actor_id: hero, asset_id: portrait, ring: 'emerald', controller_id: player },
      ]);
      await command('scene_activate', { id: secondScene });
      await as(player);
      await expect(place(hero, scene)).rejects.toThrow(/denied/);
      await place(hero, secondScene);
      const updatedSheet = {
        version: 1,
        sections: [
          {
            id: randomUUID(),
            title: 'Stats',
            fields: [{ id: randomUUID(), label: 'HP', kind: 'number', value: 7 }],
            abilities: [],
          },
        ],
      };
      await command('actor_save', {
        id: hero,
        name: 'Renamed hero',
        sheet: updatedSheet,
        revision: 0,
      });
      await appearance(hero, null, 'sapphire', 2);
      await as(gm);
      rows = (
        await db.query(
          'select t.label,t.asset_id,t.ring,a.sheet from tokens t join actors a on a.id=t.actor_id where t.actor_id=$1',
          [hero],
        )
      ).rows;
      expect(rows).toHaveLength(2);
      for (const row of rows)
        expect(row).toEqual({
          label: 'Renamed hero',
          asset_id: null,
          ring: 'sapphire',
          sheet: updatedSheet,
        });
    });

    it('rejects nonowners, granted editors, foreign assets/scenes and anonymous calls', async () => {
      await as(gm);
      await command('grant', { actor_id: hero, user_id: gm, access: 'edit' });
      const monster = (
        await command('actor_create', {
          name: 'Monster portrait',
          kind: 'enemy',
          owner_id: gm,
          sheet,
        })
      ).id;
      await command('grant', { actor_id: monster, user_id: player, access: 'edit' });
      await as(player);
      await expect(appearance(monster, null)).rejects.toThrow(/denied/);
      await expect(place(monster, secondScene)).rejects.toThrow(/denied/);
      await as(other);
      await expect(appearance(hero, null, 'gold', 3)).rejects.toThrow(/denied/);
      await expect(place(hero, secondScene, otherGame)).rejects.toThrow(/denied/);
      const foreignAsset = randomUUID();
      await db.exec('reset role');
      await db.query(
        "insert into assets(id,game_id,owner_id,kind,path,width,height) values($1,$2,$3,'token',$4,50,50)",
        [foreignAsset, otherGame, other, `foreign-${foreignAsset}.webp`],
      );
      await as(player);
      await expect(appearance(hero, foreignAsset, 'gold', 3)).rejects.toThrow(
        /Invalid token image/,
      );
      await db.exec('reset role; set role anon');
      await expect(appearance(hero, null)).rejects.toThrow(/permission denied/);
      await expect(place(hero)).rejects.toThrow(/permission denied/);
      await as(gm);
      await appearance(monster, portrait, 'amethyst');
      await place(monster, secondScene);
      await place(monster, secondScene);
      expect(
        (await db.query('select ring,asset_id from tokens where actor_id=$1', [monster])).rows,
      ).toEqual([
        { ring: 'amethyst', asset_id: portrait },
        { ring: 'amethyst', asset_id: portrait },
      ]);
      // Legacy clients cannot override the canonical appearance during placement.
      await command('token_create', { actor_id: monster, scene_id: secondScene, asset_id: null });
      expect(
        (await db.query('select distinct asset_id,ring from tokens where actor_id=$1', [monster]))
          .rows,
      ).toEqual([{ asset_id: portrait, ring: 'amethyst' }]);
      await command('grant', { actor_id: monster, user_id: player, access: 'none' });
      await as(player);
      // The concealed monster's visual projection must not expose its private sheet or image.
      expect((await db.query('select id from actors where id=$1', [monster])).rows).toHaveLength(0);
      expect((await db.query('select id from assets where id=$1', [portrait])).rows).toHaveLength(
        0,
      );
      await as(gm);
      await command('scene_update', {
        id: secondScene,
        revision: 0,
        fog: [{ x: 0, y: 0, width: 200, height: 200, reveal: true }],
      });
      await as(player);
      expect(
        (await db.query('select ring,asset_id from tokens where actor_id=$1', [monster])).rows,
      ).toHaveLength(3);
      expect((await db.query('select id from assets where id=$1', [portrait])).rows).toHaveLength(
        1,
      );
      expect((await db.query('select id from actors where id=$1', [monster])).rows).toHaveLength(0);
    });
  });
}

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
    await db.query("select record_roll($1,$2,$3,null,'1d6','public',$4,'Public roll')", [
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
    await db.query("select record_roll($1,$2,$3,null,'1d6','private',$4,'Secret player check')", [
      player,
      game,
      randomUUID(),
      outcome,
    ]);
    await db.query("select record_roll($1,$2,$3,null,'1d6','private',$4,'Secret GM check')", [
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
    expect((await db.query('select roll_type from rolls')).rows).toEqual([
      { roll_type: 'Public roll' },
    ]);
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
    for (const purpose of ['', ' ', 'x'.repeat(161), null]) {
      await expect(
        db.query("select record_roll($1,$2,$3,null,'1d6','public',$4,$5)", [
          player,
          game,
          randomUUID(),
          outcome,
          purpose,
        ]),
      ).rejects.toThrow(/constraint/);
    }
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
  it('persists and templates SRD sheets under existing database validation and permissions', async () => {
    await as(player);
    const original = createDndSheet();
    original.character = emptyCharacterDetails();
    original.character.spells.push({
      id: randomUUID(),
      name: 'Shield',
      description: 'Defensive magic',
      level: 1,
      prepared: true,
      actionType: 'Reaction',
    });
    original.character.items.push({
      id: randomUUID(),
      name: 'Wand',
      description: '',
      rarity: 'Rare',
      quantity: 1,
      requiresAttunement: true,
      attuned: true,
    });
    original.character.features.push({
      id: randomUUID(),
      name: 'Second Wind',
      description: '',
      source: 'Class',
      actionType: 'Bonus action',
      uses: 1,
      maxUses: 2,
    });
    original.character.biography.history = 'Raised by scholars';
    const id = (
      await command('actor_create', {
        name: 'SRD hero',
        kind: 'character',
        owner_id: player,
        sheet: original,
      })
    ).id;
    const saved = (await db.query<{ sheet: Sheet }>('select sheet from actors where id=$1', [id]))
      .rows[0].sheet;
    expect(sheetSchema.parse(saved)).toEqual(original);
    saved.sections.flatMap((s) => s.fields).find((f) => f.id === dndId('level'))!.value = 5;
    await command('actor_save', { id, name: 'SRD hero', sheet: saved, revision: 0 });
    await expect(
      command('actor_save', { id, name: 'Old', sheet: original, revision: 0 }),
    ).rejects.toThrow();
    await command('template_create', { actor_id: id, name: 'SRD template' });
    const template = (
      await db.query<{ sheet: Sheet }>('select sheet from templates where name=$1', [
        'SRD template',
      ])
    ).rows[0].sheet;
    expect(numericFields(template)[dndId('pb')]).toBe(3);
    expect(template.character).toEqual(original.character);
    for (const corrupt of [
      (s: Sheet) => {
        s.character!.spells[0].level = 10;
      },
      (s: Sheet) => {
        s.character!.spells[0].prepared = 'yes' as unknown as boolean;
      },
      (s: Sheet) => {
        s.character!.features[0].uses = 3;
      },
      (s: Sheet) => {
        s.character!.items[0].quantity = -1;
      },
      (s: Sheet) => {
        s.character!.items[0].requiresAttunement = false;
      },
      (s: Sheet) => {
        s.character!.items[0].rarity = 'Invalid' as 'Rare';
      },
      (s: Sheet) => {
        s.character!.features[0].id = s.character!.spells[0].id;
      },
      (s: Sheet) => {
        s.character!.biography.history = 'x'.repeat(4001);
      },
    ]) {
      const invalid = structuredClone(saved);
      corrupt(invalid);
      expect(sheetSchema.safeParse(invalid).success).toBe(false);
      await expect(
        command('actor_save', { id, name: 'Invalid', sheet: invalid, revision: 1 }),
      ).rejects.toThrow();
    }
    await as(other);
    expect((await db.query('select sheet from actors where id=$1', [id])).rows).toHaveLength(0);
    await expect(
      command('actor_save', { id, name: 'Stolen', sheet: original, revision: 1 }),
    ).rejects.toThrow();
  });
  it('limits deletion to owners/GMs, checks revisions, and preserves attributed roll history', async () => {
    await as(gm);
    const id = (
      await command('actor_create', {
        name: 'Recorded hero',
        kind: 'character',
        owner_id: player,
        sheet,
      })
    ).id;
    await command('token_create', { actor_id: id, scene_id: scene, asset_id: null });
    await command('grant', { actor_id: id, user_id: gm, access: 'edit' });
    const rollId = randomUUID();
    await db.exec('reset role; set role service_role');
    const result = JSON.stringify({
      total: 4,
      dice: [{ sides: 6, values: [4], kept: [true], total: 4 }],
      resolvedExpression: '1d6',
      modifiers: {},
    });
    await db.query(
      "select record_roll($1,$2,$3,$4,'1d6','public',$5,'Attack roll with Longsword')",
      [player, game, rollId, id, result],
    );
    // Idempotent retries never rewrite the saved context.
    await db.query("select record_roll($1,$2,$3,$4,'1d6','public',$5,'Changed label')", [
      player,
      game,
      rollId,
      id,
      result,
    ]);
    const remove = (revision: number | null, gameId = game) =>
      db.query('select delete_actor($1,$2,$3)', [gameId, id, revision]);
    await db.exec('reset role; set role anon');
    await expect(remove(0)).rejects.toThrow(/permission denied/);
    await as(other);
    await expect(remove(0)).rejects.toThrow(/denied/);
    await expect(remove(0, otherGame)).rejects.toThrow(/denied/);
    await as(player);
    await expect(remove(null)).rejects.toThrow(/changed/);
    await command('actor_save', { id, name: 'Renamed hero', sheet, revision: 0 });
    await expect(remove(0)).rejects.toThrow(/changed/);
    await remove(1);
    expect((await db.query('select id from actors where id=$1', [id])).rows).toHaveLength(0);
    await as(gm);
    expect((await db.query('select id from tokens where actor_id=$1', [id])).rows).toHaveLength(0);
    expect(
      (await db.query('select * from sheet_grants where actor_id=$1', [id])).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query('select actor_id,actor_name,roll_type,game_id from rolls where id=$1', [
          rollId,
        ])
      ).rows,
    ).toEqual([
      {
        actor_id: null,
        actor_name: 'Recorded hero',
        roll_type: 'Attack roll with Longsword',
        game_id: game,
      },
    ]);
    const gmActor = (
      await command('actor_create', {
        name: 'GM may delete',
        kind: 'character',
        owner_id: player,
        sheet,
      })
    ).id;
    await db.query('select delete_actor($1,$2,0)', [game, gmActor]);
    expect((await db.query('select id from actors where id=$1', [gmActor])).rows).toHaveLength(0);
  });
  it('does not allow sheet edit grants or token control to delete a GM character', async () => {
    await as(gm);
    const id = (
      await command('actor_create', {
        name: 'Not owned',
        kind: 'npc',
        owner_id: gm,
        sheet,
      })
    ).id;
    await command('grant', { actor_id: id, user_id: player, access: 'edit' });
    await command('token_create', { actor_id: id, scene_id: scene, asset_id: null });
    const placed = (await db.query<{ id: string }>('select id from tokens where actor_id=$1', [id]))
      .rows[0];
    await command('token_update', { id: placed.id, revision: 0, controller_id: player });
    await as(player);
    await expect(db.query('select delete_actor($1,$2,0)', [game, id])).rejects.toThrow(/denied/);
    await as(gm);
    await db.query('select delete_actor($1,$2,0)', [game, id]);
  });
  it('creates and saves source-valid builder sheets through the real authorized RPC', async () => {
    await as(player);
    for (const name of srdClasses) {
      const initial = applySrdBuilder(createDndSheet(), classBuilder(name));
      expect(sheetSchema.safeParse(initial).success, `${name} level 1 app validation`).toBe(true);
      const id = (
        await command('actor_create', {
          name: `${name} builder`,
          kind: 'character',
          owner_id: player,
          sheet: initial,
        })
      ).id;
      const advanced = applySrdBuilder(initial, classBuilder(name, 20));
      expect(sheetSchema.safeParse(advanced).success, `${name} level 20 app validation`).toBe(true);
      await command('actor_save', { id, name: `${name} 20`, sheet: advanced, revision: 0 });
      const saved = (await db.query<{ sheet: Sheet }>('select sheet from actors where id=$1', [id]))
        .rows[0].sheet;
      expect(saved.character?.builder?.levels).toHaveLength(20);
      expect(
        saved.sections
          .flatMap((section) => section.fields)
          .find((field) => field.id === dndId('level'))?.value,
      ).toBe(20);
      await expect(
        command('actor_save', { id, name: 'Stale', sheet: initial, revision: 0 }),
      ).rejects.toThrow(/changed/);
    }
    const multi = applySrdBuilder(createDndSheet(), multiclassBuilder());
    expect(sheetSchema.safeParse(multi).success).toBe(true);
    const id = (
      await command('actor_create', {
        name: 'Multiclass',
        kind: 'character',
        owner_id: player,
        sheet: multi,
      })
    ).id;
    const template = await command('template_create', {
      actor_id: id,
      name: 'Multiclass template',
    });
    expect(template).toBeDefined();
    await as(other);
    expect((await db.query('select id from actors where id=$1', [id])).rows).toHaveLength(0);
    await expect(
      command('actor_save', { id, name: 'Stolen', sheet: multi, revision: 0 }),
    ).rejects.toThrow(/denied/);
  });
  it('rejects forged builder choices, incompatible statistics, and malformed details through direct create/save calls', async () => {
    await as(player);
    const valid = applySrdBuilder(createDndSheet(), fighterBuilder());
    const id = (
      await command('actor_create', {
        name: 'Protected builder',
        kind: 'character',
        owner_id: player,
        sheet: valid,
      })
    ).id;
    for (const corrupt of [
      (s: Sheet) => {
        s.character!.builder!.levels[0].skills = ['Forged skill', 'Insight'];
      },
      (s: Sheet) => {
        s.character!.builder!.levels[0].hp = 999;
      },
      (s: Sheet) => {
        s.character!.builder!.backgroundBoosts = [2, 2, 2, 2, 2, 2];
      },
      (s: Sheet) => {
        s.sections
          .flatMap((section) => section.fields)
          .find((field) => field.id === dndId('level'))!.value = 20;
      },
      (s: Sheet) => {
        s.sections
          .flatMap((section) => section.fields)
          .find((field) => field.id === dndId('score:0'))!.value = 30;
      },
      (s: Sheet) => {
        s.character!.items[0].quantity = -1;
      },
    ]) {
      const invalid = structuredClone(valid);
      corrupt(invalid);
      expect(sheetSchema.safeParse(invalid).success).toBe(false);
      await expect(
        command('actor_create', {
          name: 'Invalid builder',
          kind: 'character',
          owner_id: player,
          sheet: invalid,
        }),
      ).rejects.toThrow(/constraint/);
      await expect(
        command('actor_save', {
          id,
          name: 'Invalid builder',
          sheet: invalid,
          revision: 0,
        }),
      ).rejects.toThrow(/constraint/);
    }
  });
  it('persists the Thief fourth attunement through the legacy sheet validator without allowing a fifth', async () => {
    await as(player);
    const sheet = applySrdBuilder(createDndSheet(), classBuilder('Rogue', 13));
    sheet.character!.items = Array.from({ length: 4 }, (_, index) => ({
      id: randomUUID(),
      name: `Thief relic ${index}`,
      description: '',
      rarity: 'Rare',
      quantity: 1,
      requiresAttunement: true,
      attuned: true,
    }));
    expect(sheetSchema.safeParse(sheet).success).toBe(true);
    const id = (
      await command('actor_create', {
        name: 'Thief attunement',
        kind: 'character',
        owner_id: player,
        sheet,
      })
    ).id;
    sheet.character!.items.push({ ...sheet.character!.items[0], id: randomUUID() });
    expect(sheetSchema.safeParse(sheet).success).toBe(false);
    await expect(
      command('actor_save', {
        id,
        name: 'Fifth relic',
        sheet,
        revision: 0,
      }),
    ).rejects.toThrow(/constraint/);
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
  it('transfers ownership only within the game, rejects stale writes, and removes former owner access/control', async () => {
    const nextOwner = randomUUID();
    await db.exec('reset role');
    await db.query('insert into auth.users values($1)', [nextOwner]);
    await as(gm);
    const invitation = (await command('invite')).token;
    await as(nextOwner);
    await db.query("select accept_invite($1,'New owner')", [invitation]);
    await as(gm);
    const id = (
      await command('actor_create', {
        name: 'Transfer hero',
        kind: 'character',
        owner_id: player,
        sheet,
      })
    ).id;
    await command('token_create', { actor_id: id, scene_id: scene, asset_id: null });
    await command('grant', { actor_id: id, user_id: player, access: 'edit' });
    await command('grant', { actor_id: id, user_id: nextOwner, access: 'view' });
    const transfer = (owner: string, revision: number | null, gameId = game) =>
      db.query('select transfer_actor_owner($1,$2,$3,$4)', [gameId, id, owner, revision]);
    await db.exec('reset role; set role anon');
    await expect(transfer(nextOwner, 0)).rejects.toThrow(/permission denied/);
    await as(player);
    await expect(transfer(nextOwner, 0)).rejects.toThrow(/GM required/);
    await expect(
      command('grant', { actor_id: id, user_id: nextOwner, access: 'edit' }),
    ).rejects.toThrow(/GM required/);
    await as(gm);
    await expect(transfer(other, 0)).rejects.toThrow(/Invalid/);
    await expect(transfer(nextOwner, 99)).rejects.toThrow(/changed/);
    await expect(transfer(nextOwner, null)).rejects.toThrow(/changed/);
    await as(other);
    await expect(transfer(other, 0, otherGame)).rejects.toThrow(/Invalid/);
    await as(gm);
    await transfer(nextOwner, 0);
    const actorRow = (
      await db.query<{ owner_id: string; revision: number }>(
        'select owner_id,revision from actors where id=$1',
        [id],
      )
    ).rows[0];
    expect(actorRow).toEqual({ owner_id: nextOwner, revision: 1 });
    await transfer(nextOwner, 1);
    expect(
      (await db.query<{ revision: number }>('select revision from actors where id=$1', [id]))
        .rows[0].revision,
    ).toBe(1);
    const tokenRows = (
      await db.query<{ controller_id: string; revision: number }>(
        'select controller_id,revision from tokens where actor_id=$1',
        [id],
      )
    ).rows;
    expect(tokenRows).toEqual([{ controller_id: nextOwner, revision: 1 }]);
    expect(
      (await db.query('select * from sheet_grants where actor_id=$1', [id])).rows,
    ).toHaveLength(0);
    await expect(transfer(player, 0)).rejects.toThrow(/changed/);
    await as(player);
    expect((await db.query('select * from actors where id=$1', [id])).rows).toHaveLength(0);
    await expect(command('actor_save', { id, name: 'Stolen', sheet, revision: 1 })).rejects.toThrow(
      /denied/,
    );
    await db.exec('reset role; set role service_role');
    await expect(
      db.query("select record_roll($1,$2,$3,$4,'1d6','public',$5)", [
        player,
        game,
        randomUUID(),
        id,
        JSON.stringify({
          total: 1,
          dice: [{ sides: 6, values: [1], kept: [true], total: 1 }],
          resolvedExpression: '1d6',
          modifiers: {},
        }),
      ]),
    ).rejects.toThrow(/control required/);
    await as(nextOwner);
    await command('actor_save', { id, name: 'Owned hero', sheet, revision: 1 });
    await as(gm);
    await command('grant', { actor_id: id, user_id: player, access: 'view' });
    await as(player);
    expect((await db.query('select * from actors where id=$1', [id])).rows).toHaveLength(1);
    await expect(
      command('actor_save', { id, name: 'Read only', sheet, revision: 2 }),
    ).rejects.toThrow(/denied/);
    await as(gm);
    await command('grant', { actor_id: id, user_id: player, access: 'none' });
    await as(player);
    expect((await db.query('select * from actors where id=$1', [id])).rows).toHaveLength(0);
  });
});

persistentActorTests();

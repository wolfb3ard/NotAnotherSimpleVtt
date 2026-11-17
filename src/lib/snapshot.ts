import 'server-only';
import { supabaseServer } from './supabase/server';
import type { Snapshot } from './types';

export async function getSnapshot(gameId: string, prepare?: string): Promise<Snapshot> {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error('Login required');
  const { data: game, error } = await db.from('games').select('*').eq('id', gameId).single();
  if (error || !game) throw new Error('Game access denied');
  const gm = game.gm_id === user.id;
  const sceneId = gm && prepare ? prepare : game.active_scene_id;
  const [queries, encounterQuery, tacticalQuery] = await Promise.all([
    Promise.all([
      db.from('memberships').select('user_id,role,display_name').eq('game_id', gameId),
      db.from('actors').select('*').eq('game_id', gameId).order('name'),
      db.from('scenes').select('*').eq('game_id', gameId).order('name'),
      db
        .from('tokens')
        .select('*')
        .eq('game_id', gameId)
        .eq('scene_id', sceneId ?? '00000000-0000-0000-0000-000000000000'),
      db.from('templates').select('*').eq('game_id', gameId).order('name'),
      db
        .from('roll_cues')
        .select('roll_id,private,created_at')
        .eq('game_id', gameId)
        .order('created_at', { ascending: false })
        .limit(50),
    ]),
    db.rpc('encounter_snapshot', { p_game: gameId, p_scene: game.active_scene_id }),
    db.rpc('tactical_template_snapshot', { p_game: gameId }),
  ]);
  for (const q of [...queries, encounterQuery, tacticalQuery])
    if (q.error) throw new Error('Unable to load room data.');
  const [members, actors, scenes, tokens, templates, rollCues] = queries.map((q) => q.data ?? []);
  if (gm && prepare && !scenes.some((s) => s.id === prepare))
    throw new Error('Prepared scene is unavailable.');
  // Read the results after the cues: a newly committed cue must not outrun
  // its authorized roll because these requests use separate DB transactions.
  const rollQuery = await db
    .from('rolls')
    .select('*')
    .eq('game_id', gameId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (rollQuery.error) throw new Error('Unable to load rolls.');
  const rolls = rollQuery.data ?? [];
  const styles = members.length
    ? await db
        .from('dice_styles')
        .select('user_id,style')
        .in(
          'user_id',
          members.map((m) => m.user_id),
        )
    : { data: [], error: null };
  if (styles.error) throw new Error('Unable to load dice appearances.');
  const actorIds = actors.map((a) => a.id);
  const grants = actorIds.length
    ? await db.from('sheet_grants').select('*').in('actor_id', actorIds)
    : { data: [], error: null };
  if (grants.error) throw new Error('Unable to load sheet permissions.');
  const groups = gm
    ? await db.from('encounter_groups').select('id,name,labels').eq('game_id', gameId).order('name')
    : { data: [], error: null };
  if (groups.error) throw new Error('Unable to load encounter groups.');
  const ownRoll = await db
    .from('rolls')
    .select('id')
    .eq('game_id', gameId)
    .eq('author_id', user.id)
    .limit(1);
  if (ownRoll.error) throw new Error('Unable to load setup state.');
  let onboarding: Snapshot['onboarding'] = {
    invited: false,
    spawn: null,
    hasRolled: !!ownRoll.data?.length,
  };
  if (gm) {
    const [invitations, spawn] = await Promise.all([
      db
        .from('invitations')
        .select('game_id')
        .eq('game_id', gameId)
        .eq('revoked', false)
        .gt('expires_at', new Date().toISOString())
        .limit(1),
      db
        .from('party_spawns')
        .select('x,y')
        .eq('game_id', gameId)
        .eq('scene_id', sceneId ?? '00000000-0000-0000-0000-000000000000')
        .maybeSingle(),
    ]);
    if (invitations.error || spawn.error) throw new Error('Unable to load setup state.');
    onboarding = { ...onboarding, invited: !!invitations.data?.length, spawn: spawn.data };
  }
  return {
    preparedSceneId:
      gm && prepare && scenes.some((s) => s.id === prepare) && prepare !== game.active_scene_id
        ? prepare
        : undefined,
    groups: groups.data,
    game,
    role: game.gm_id === user.id ? 'gm' : 'player',
    userId: user.id,
    members,
    actors,
    scenes,
    tokens,
    templates,
    rolls,
    diceStyles: styles.data ?? [],
    rollCues,
    grants: grants.data ?? [],
    encounter: encounterQuery.data ?? null,
    tacticalTemplates: tacticalQuery.data ?? [],
    onboarding,
  } as Snapshot;
}

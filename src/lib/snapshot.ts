import 'server-only';
import { supabaseServer } from './supabase/server';
import type { Snapshot } from './types';

export async function getSnapshot(gameId: string): Promise<Snapshot> {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error('Login required');
  const { data: game, error } = await db.from('games').select('*').eq('id', gameId).single();
  if (error || !game) throw new Error('Game access denied');
  const queries = await Promise.all([
    db.from('memberships').select('user_id,role,display_name').eq('game_id', gameId),
    db.from('actors').select('*').eq('game_id', gameId).order('name'),
    db.from('scenes').select('*').eq('game_id', gameId).order('name'),
    db
      .from('tokens')
      .select('*')
      .eq('game_id', gameId)
      .eq('scene_id', game.active_scene_id ?? '00000000-0000-0000-0000-000000000000'),
    db.from('templates').select('*').eq('game_id', gameId).order('name'),
    db
      .from('roll_cues')
      .select('roll_id,private,created_at')
      .eq('game_id', gameId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  for (const q of queries) if (q.error) throw new Error('Unable to load room data.');
  const [members, actors, scenes, tokens, templates, rollCues] = queries.map((q) => q.data ?? []);
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
  return {
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
  } as Snapshot;
}

import { beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ rpc }) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
import { mutate } from './actions';
const game = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scene = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
});

it('routes canonical appearance to its authenticated, revision-protected RPC', async () => {
  await mutate(game, 'actor_appearance', { id: actor, asset_id: null, ring: 'ruby', revision: 2 });
  expect(rpc).toHaveBeenCalledWith('save_actor_appearance', {
    p_game: game,
    p_actor: actor,
    p_asset: null,
    p_ring: 'ruby',
    p_revision: 2,
  });
});
it('places using the actor identity and ignores scene-specific images or stats', async () => {
  await mutate(game, 'token_create', {
    actor_id: actor,
    scene_id: scene,
    asset_id: actor,
    sheet: {},
  });
  expect(rpc).toHaveBeenCalledWith('place_actor_token', {
    p_game: game,
    p_actor: actor,
    p_scene: scene,
  });
});
it.each([
  { id: actor, asset_id: null, ring: 'custom', revision: 0 },
  { id: actor, asset_id: null, ring: 'gold', revision: -1 },
  { id: actor, asset_id: 'invalid', ring: 'gold', revision: 0 },
])('rejects malformed appearance commands', async (payload) => {
  expect(await mutate(game, 'actor_appearance', payload)).toHaveProperty('error');
  expect(rpc).not.toHaveBeenCalled();
});

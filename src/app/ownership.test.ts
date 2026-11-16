import { beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ rpc }) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
import { mutate } from './actions';
const game = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const owner = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
});

it('dispatches ownership to its authenticated, game-scoped RPC with revision protection', async () => {
  expect(
    await mutate(game, 'actor_owner', { actor_id: actor, owner_id: owner, revision: 3 }),
  ).toEqual({ data: {} });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('transfer_actor_owner', {
    p_game: game,
    p_actor: actor,
    p_owner: owner,
    p_revision: 3,
  });
});
it.each([
  { actor_id: actor, owner_id: 'invalid', revision: 0 },
  { actor_id: actor, owner_id: owner, revision: -1 },
  { actor_id: actor, owner_id: owner },
])('rejects malformed ownership requests before database access', async (payload) => {
  expect(await mutate(game, 'actor_owner', payload)).toHaveProperty('error');
  expect(rpc).not.toHaveBeenCalled();
});
it('returns backend authorization failures without reporting success', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'GM required' } });
  expect(
    await mutate(game, 'actor_owner', { actor_id: actor, owner_id: owner, revision: 0 }),
  ).toEqual({ error: 'GM required' });
});
it('does not permit ownership changes through sheet saves', async () => {
  const sheet = { version: 1, sections: [] };
  await mutate(game, 'actor_save', {
    id: actor,
    name: 'Hero',
    sheet,
    revision: 0,
    owner_id: owner,
  });
  expect(rpc).toHaveBeenCalledWith('mutate_game', {
    p_game: game,
    p_command: 'actor_save',
    p: { id: actor, name: 'Hero', sheet, revision: 0 },
  });
});

it('dispatches deletion to the authenticated RPC with the observed revision', async () => {
  expect(await mutate(game, 'actor_delete', { id: actor, revision: 3 })).toEqual({ data: {} });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('delete_actor', {
    p_game: game,
    p_actor: actor,
    p_revision: 3,
  });
});

it.each([{ id: actor }, { id: actor, revision: -1 }, { id: 'invalid', revision: 0 }])(
  'rejects malformed deletion requests',
  async (payload) => {
    expect(await mutate(game, 'actor_delete', payload)).toHaveProperty('error');
    expect(rpc).not.toHaveBeenCalled();
  },
);

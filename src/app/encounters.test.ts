import { beforeEach, expect, it, vi } from 'vitest';
import { createDndSheet } from '@/lib/dnd';
const { rpc, adminRpc, from, getUser } = vi.hoisted(() => ({
  rpc: vi.fn(),
  adminRpc: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ rpc, from, auth: { getUser } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: adminRpc }) }));
import { mutate } from './actions';
const game = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scene = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const token = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  actor = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const operation = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const request = {
  action: 'start',
  scene_id: scene,
  operation_id: operation,
  participants: [{ token_id: token, initiative: null }],
};
let fixtures: Record<string, unknown[]>;
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
  adminRpc.mockResolvedValue({ data: { id: 'created', revision: '1' }, error: null });
  getUser.mockResolvedValue({ data: { user: { id: 'gm' } } });
  fixtures = {
    games: [{ id: game, gm_id: 'gm', active_scene_id: scene, dice: [4, 6, 8, 10, 12, 20, 100] }],
    tokens: [{ id: token, actor_id: actor, revision: 2 }],
    actors: [{ id: actor, revision: 3, sheet: createDndSheet() }],
  };
  from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      in: async () => ({ data: fixtures[table], error: null }),
      single: async () => ({ data: fixtures[table]?.[0] ?? null, error: null }),
    };
    return query;
  });
});
it('routes manual encounter changes through the authorized user RPC without service credentials', async () => {
  rpc.mockResolvedValue({ data: { id: 'created', revision: '1' }, error: null });
  const manual = { ...request, participants: [{ token_id: token, initiative: 14 }] };
  expect(await mutate(game, 'encounter', manual)).toEqual({
    data: { id: 'created', revision: '1' },
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('encounter_command', { p_game: game, p: manual });
  expect(adminRpc).not.toHaveBeenCalled();
});
it('uses saved sheet fields and the authoritative dice engine, then commits the entire private batch', async () => {
  expect(await mutate(game, 'encounter', request)).toHaveProperty('data.id', 'created');
  expect(rpc).toHaveBeenCalledExactlyOnceWith('encounter_receipt', { p_game: game, p: request });
  const [name, payload] = adminRpc.mock.calls[0];
  expect(name).toBe('commit_encounter_rolls');
  expect(payload).toMatchObject({
    p_user: 'gm',
    p_game: game,
    p: request,
    p_rolls: [
      {
        token_id: token,
        token_revision: 2,
        actor_id: actor,
        actor_revision: 3,
        result: { dice: [{ sides: 20 }] },
      },
    ],
  });
  expect(payload.p_rolls[0].result.total).toBeGreaterThanOrEqual(1);
  expect(payload.p_rolls[0].result.total).toBeLessThanOrEqual(20);
  expect(payload.p_rolls[0].roll_id).toMatch(/^[a-f0-9-]{36}$/);
});
it('acknowledges a committed retry before reading or rerolling a changed/deleted sheet', async () => {
  rpc.mockResolvedValue({ data: { id: 'previous', revision: '1' }, error: null });
  expect(await mutate(game, 'encounter', request)).toEqual({
    data: { id: 'previous', revision: '1' },
  });
  expect(from).not.toHaveBeenCalled();
  expect(adminRpc).not.toHaveBeenCalled();
});
it.each([
  { ...request, participants: [{ token_id: token, initiative: Infinity }] },
  { ...request, participants: [...request.participants, ...request.participants] },
  { ...request, p_rolls: [{ result: { total: 20 } }] },
  { ...request, operation_id: undefined },
])('rejects malformed or forged requests before any database call', async (payload) => {
  expect(await mutate(game, 'encounter', payload)).toHaveProperty('error');
  expect(rpc).not.toHaveBeenCalled();
  expect(adminRpc).not.toHaveBeenCalled();
});
it('honors the GM receipt authorization boundary and never reads private sources for a denied caller', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'GM required' } });
  expect(await mutate(game, 'encounter', request)).toEqual({ error: 'GM required' });
  expect(from).not.toHaveBeenCalled();
  expect(adminRpc).not.toHaveBeenCalled();
});
it('rejects an inactive scene, missing sheet rules, or disabled dice without persisting any rolls', async () => {
  fixtures.games = [{ gm_id: 'gm', active_scene_id: game, dice: [20] }];
  expect(await mutate(game, 'encounter', request)).toHaveProperty('error');
  fixtures.games = [{ gm_id: 'gm', active_scene_id: scene, dice: [6] }];
  expect(await mutate(game, 'encounter', request)).toHaveProperty('error');
  fixtures.games = [{ gm_id: 'gm', active_scene_id: scene, dice: [20] }];
  fixtures.actors = [{ id: actor, revision: 3, sheet: { version: 1, sections: [] } }];
  expect(await mutate(game, 'encounter', request)).toHaveProperty(
    'error',
    expect.stringContaining('manual total'),
  );
  expect(adminRpc).not.toHaveBeenCalled();
});
it('surfaces concurrent source/encounter changes without claiming a successful roll', async () => {
  adminRpc.mockResolvedValue({ data: null, error: { message: 'Initiative source changed' } });
  expect(await mutate(game, 'encounter', request)).toEqual({ error: 'Initiative source changed' });
});

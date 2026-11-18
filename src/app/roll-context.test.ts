import { beforeEach, expect, it, vi } from 'vitest';

const { rpc, getUser, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { getUser }, from }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));
import { roll } from './actions';
import { createDndSheet } from '@/lib/dnd';
import { initiativeExpression } from '@/lib/initiative';

const game = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const payload = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  actor_id: null,
  expression: '1d6',
  visibility: 'public',
};
beforeEach(() => {
  vi.resetAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: user } } });
  from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: () => query,
      single: async () => ({ data: { dice: [6] } }),
    };
    return query;
  });
  rpc.mockResolvedValue({ error: null });
});

it('passes a bounded purpose to the server-only roll RPC, never a client-supplied character name', async () => {
  expect(
    await roll(game, { ...payload, roll_type: '  Athletics check ', actor_name: 'Spoof' }),
  ).toHaveProperty('success', true);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    'record_roll',
    expect.objectContaining({
      p_user: user,
      p_game: game,
      p_actor: null,
      p_roll_type: 'Athletics check',
    }),
  );
  expect(rpc.mock.calls[0][1]).not.toHaveProperty('actor_name');
});
it('defaults unlabelled manual rolls', async () => {
  await roll(game, payload);
  expect(rpc).toHaveBeenCalledWith(
    'record_roll',
    expect.objectContaining({ p_roll_type: 'Manual roll' }),
  );
});
it.each(['', '  ', 'x'.repeat(161)])(
  'rejects invalid roll purpose before database access',
  async (roll_type) => {
    expect(await roll(game, { ...payload, roll_type })).toHaveProperty('error');
    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  },
);
it('does not report success when character control is denied', async () => {
  rpc.mockResolvedValue({ error: { message: 'Character control required' } });
  expect(await roll(game, payload)).toEqual({ error: 'Character control required' });
});

it('only links a server-validated sheet initiative roll and returns the committed result', async () => {
  const sheet = createDndSheet();
  const scene = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const actor = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  from.mockImplementation((table) => {
    const query = {
      select: () => query,
      eq: () => query,
      single: async () => ({
        data: table === 'games' ? { dice: [20], active_scene_id: scene } : { sheet, revision: 7 },
      }),
    };
    return query;
  });
  rpc.mockResolvedValue({ error: null, data: { total: 12 } });
  const initiative = { ...payload, actor_id: actor, sheet_initiative: true };
  expect(await roll(game, { ...initiative, expression: '1000' })).toHaveProperty('error');
  expect(rpc).not.toHaveBeenCalled();
  expect(
    await roll(game, { ...initiative, expression: initiativeExpression(sheet) }),
  ).toMatchObject({ success: true, result: { total: 12 } });
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    'commit_sheet_initiative',
    expect.objectContaining({ p_actor: actor, p_revision: 7, p_scene: scene, p_user: user }),
  );
});

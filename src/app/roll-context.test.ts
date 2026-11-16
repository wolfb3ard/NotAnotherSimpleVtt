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

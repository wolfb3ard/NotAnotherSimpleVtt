import { beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ rpc }) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
import { mutate } from './actions';
import { emptyCombat } from '@/lib/combat';
const game = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const payload = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  operation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  revision: 2,
  state: emptyCombat(),
};
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { id: payload.id, revision: '3' }, error: null });
});
it('dispatches combat state to its authorized revision/idempotency boundary', async () => {
  expect(await mutate(game, 'actor_combat', payload)).toHaveProperty('data');
  expect(rpc).toHaveBeenCalledExactlyOnceWith('save_actor_combat', {
    p_game: game,
    p_actor: payload.id,
    p_revision: 2,
    p_operation: payload.operation_id,
    p_state: payload.state,
  });
});
it.each([
  { ...payload, revision: -1 },
  { ...payload, operation_id: undefined },
  { ...payload, state: { ...emptyCombat(), death: { successes: 4, failures: 0, stable: false } } },
  { ...payload, state: { ...emptyCombat(), secret: true } },
])('rejects invalid combat requests before RPC', async (request) => {
  expect(await mutate(game, 'actor_combat', request)).toHaveProperty('error');
  expect(rpc).not.toHaveBeenCalled();
});
it('does not confirm denied/stale writes', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'Combat edit denied' } });
  expect(await mutate(game, 'actor_combat', payload)).toEqual({ error: 'Combat edit denied' });
});

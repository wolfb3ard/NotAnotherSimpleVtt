import { beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ rpc }) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
import { mutate } from './actions';
import { dndId } from '@/lib/dnd';
const game = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const operation = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const payload = {
  id: actor,
  revision: 2,
  operation_id: operation,
  changes: [{ id: dndId('hp'), value: 3 }],
};
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { revision: '3', sheet: '{}' }, error: null });
});
it('dispatches a scoped, revision-checked, idempotent resource operation', async () => {
  expect(await mutate(game, 'actor_resources', payload)).toEqual({
    data: { revision: '3', sheet: '{}' },
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('adjust_actor_resources', {
    p_game: game,
    p_actor: actor,
    p_revision: 2,
    p_operation: operation,
    p_changes: payload.changes,
  });
});
it.each([
  { ...payload, revision: -1 },
  { ...payload, operation_id: undefined },
  { ...payload, changes: [] },
  { ...payload, changes: [{ id: dndId('hp'), value: 1, max: 100 }] },
  { ...payload, changes: [{ id: dndId('hp'), value: -1 }] },
])('rejects invalid resource payloads before database access', async (value) => {
  expect(await mutate(game, 'actor_resources', value)).toHaveProperty('error');
  expect(rpc).not.toHaveBeenCalled();
});
it('does not treat access or revision errors as saved', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'Resource edit denied' } });
  expect(await mutate(game, 'actor_resources', payload)).toEqual({ error: 'Resource edit denied' });
});

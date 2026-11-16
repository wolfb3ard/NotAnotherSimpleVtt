import { beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ rpc }) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
import { mutate } from './actions';
import { createMonsterSheet } from '@/lib/srd-monsters';
const game = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scene = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const operation = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const request = {
  scene_id: scene,
  operation_id: operation,
  count: 6,
  source: { kind: 'srd', monster_id: 'monster-aboleth' },
};
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { id: 'created', count: '6' }, error: null });
});
it('resolves authoritative SRD content on the server, not client-supplied monster sheets', async () => {
  expect(await mutate(game, 'creature_add', request)).toEqual({
    data: { id: 'created', count: '6' },
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('create_encounter_creatures', {
    p_game: game,
    p_scene: scene,
    p_operation: operation,
    p_count: 6,
    p_source: null,
    p_revision: null,
    p_name: 'Aboleth',
    p_sheet: createMonsterSheet('monster-aboleth'),
  });
});
it('scopes independent copies to a game, scene, source and source revision', async () => {
  await mutate(game, 'creature_add', {
    ...request,
    source: { kind: 'actor', actor_id: scene, revision: 4 },
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('create_encounter_creatures', {
    p_game: game,
    p_scene: scene,
    p_operation: operation,
    p_count: 6,
    p_source: scene,
    p_revision: 4,
    p_name: null,
    p_sheet: null,
  });
});
it.each([
  { ...request, count: 21 },
  { ...request, count: 0 },
  { ...request, count: 1.5 },
  { ...request, operation_id: undefined },
  { ...request, source: { kind: 'srd', monster_id: 'missing' } },
  { ...request, sheet: {} },
  { ...request, source: { kind: 'actor', actor_id: scene } },
])('rejects invalid/forged source data without a database call', async (payload) => {
  expect(await mutate(game, 'creature_add', payload)).toHaveProperty('error');
  expect(rpc).not.toHaveBeenCalled();
});
it('returns GM authorization and revision failures without claiming creation succeeded', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'GM required' } });
  expect(await mutate(game, 'creature_add', request)).toEqual({ error: 'GM required' });
});

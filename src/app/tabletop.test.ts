import { beforeEach, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ rpc }) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));
import { mutate } from './actions';
const game = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const scene = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const operation = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { history: '[]' }, error: null });
});
it.each(['tabletop_move', 'tabletop_fog', 'tabletop_undo', 'tabletop_history'] as const)(
  'routes %s to the authorized boundary',
  async (command) => {
    const payload = {
      id: scene,
      scene_id: scene,
      operation_id: operation,
      revision: 2,
      x: 50,
      y: 50,
      fog: [],
    };
    expect(await mutate(game, command, payload)).toEqual({ data: { history: '[]' } });
    expect(rpc).toHaveBeenCalledWith('tabletop_command', {
      p_game: game,
      p_command: command,
      p: expect.objectContaining({ scene_id: scene }),
    });
  },
);
it.each([
  { scene_id: scene, revision: 0, x: 20, y: 20 },
  { id: scene, scene_id: scene, operation_id: operation, revision: -1, x: 20, y: 20 },
  { id: scene, scene_id: scene, operation_id: operation, revision: 0, x: Infinity, y: 20 },
])('rejects invalid moves before RPC', async (payload) => {
  expect(await mutate(game, 'tabletop_move', payload)).toHaveProperty('error');
  expect(rpc).not.toHaveBeenCalled();
});

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
it('routes shared grid settings to their authorized revision-checked boundary', async () => {
  const p = {
    scene_id: scene,
    revision: 2,
    operation_id: operation,
    grid: { enabled: true, size: 50, origin_x: 10, origin_y: 20 },
  };
  await mutate(game, 'scene_grid', p);
  expect(rpc).toHaveBeenCalledWith('configure_scene_grid', { p_game: game, p });
});
it.each([0, -5, NaN, Infinity, 1025])(
  'rejects invalid grid cell size %s before RPC',
  async (size) => {
    expect(
      await mutate(game, 'scene_grid', {
        scene_id: scene,
        revision: 2,
        operation_id: operation,
        grid: { enabled: true, size, origin_x: 0, origin_y: 0 },
      }),
    ).toHaveProperty('error');
    expect(rpc).not.toHaveBeenCalled();
  },
);

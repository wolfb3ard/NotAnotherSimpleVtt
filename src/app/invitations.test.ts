import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { rpc, requestHeaders } = vi.hoisted(() => ({ rpc: vi.fn(), requestHeaders: vi.fn() }));
vi.mock('next/headers', () => ({ headers: requestHeaders }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ rpc }) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));

import { mutate } from './actions';

const gameId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = 'b'.repeat(48);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://gather.vercel.app');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'gather.vercel.app');
  vi.stubEnv('VERCEL_ENV', 'production');
  requestHeaders.mockResolvedValue(
    new Headers({ host: 'gather-team.vercel.app', 'x-forwarded-proto': 'https' }),
  );
  rpc.mockResolvedValue({ data: { token }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

it('returns a server-generated public invitation URL after the authorized RPC succeeds', async () => {
  expect(await mutate(gameId, 'invite', {})).toEqual({
    data: { token, url: `https://gather.vercel.app/invite/${token}` },
  });
  expect(rpc).toHaveBeenCalledWith('mutate_game', { p_game: gameId, p_command: 'invite', p: {} });
});

it('does not generate an invitation URL when the RPC denies access', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'Access denied' } });
  expect(await mutate(gameId, 'invite', {})).toEqual({ error: 'Access denied' });
  expect(requestHeaders).not.toHaveBeenCalled();
});

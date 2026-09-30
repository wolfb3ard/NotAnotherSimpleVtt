import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { signInWithOtp, exchangeCodeForSession, requestHeaders } = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  requestHeaders: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: requestHeaders }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { signInWithOtp, exchangeCodeForSession } }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));

import { login } from '../actions';
import { GET } from './callback/route';

const publicSite = 'https://gather.example.com';
const protectedSite = 'https://gather-deployment.vercel.app';
const invite = `/invite/${'a'.repeat(48)}`;

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', protectedSite);
  vi.stubEnv('VERCEL_URL', 'gather-deployment.vercel.app');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'gather.vercel.app');
  signInWithOtp.mockResolvedValue({ error: null });
  exchangeCodeForSession.mockResolvedValue({ error: null });
  requestHeaders.mockResolvedValue(
    new Headers({
      origin: publicSite,
      host: 'gather-deployment.vercel.app',
      'x-forwarded-host': 'gather.example.com',
      'x-forwarded-proto': 'https',
    }),
  );
});

it('sends sign-in links to the browser origin, not a configured protected deployment', async () => {
  const form = new FormData();
  form.set('email', 'player@example.com');
  form.set('next', invite);
  expect(await login(form)).toHaveProperty('success');
  expect(signInWithOtp).toHaveBeenCalledWith({
    email: 'player@example.com',
    options: { emailRedirectTo: `${publicSite}/auth/callback?next=${encodeURIComponent(invite)}` },
  });
});

it('keeps local sign-in on localhost even with production environment URLs', async () => {
  requestHeaders.mockResolvedValue(
    new Headers({ origin: 'http://localhost:3000', host: 'localhost:3000' }),
  );
  const form = new FormData();
  form.set('email', 'player@example.com');
  form.set('next', 'https://evil.example.com');
  await login(form);
  expect(signInWithOtp).toHaveBeenCalledWith({
    email: 'player@example.com',
    options: { emailRedirectTo: 'http://localhost:3000/auth/callback?next=%2F' },
  });
});

it('uses the forwarded public host when the browser origin is absent', async () => {
  requestHeaders.mockResolvedValue(
    new Headers({
      host: 'gather-deployment.vercel.app',
      'x-forwarded-host': 'gather.example.com',
      'x-forwarded-proto': 'https',
    }),
  );
  const form = new FormData();
  form.set('email', 'player@example.com');
  await login(form);
  expect(signInWithOtp.mock.calls[0][0].options.emailRedirectTo).toBe(
    `${publicSite}/auth/callback?next=%2F`,
  );
});

it('returns successful callbacks to the same site and preserves invitations', async () => {
  const response = await GET(
    new Request(`${publicSite}/auth/callback?code=test-code&next=${invite}`),
  );
  expect(exchangeCodeForSession).toHaveBeenCalledWith('test-code');
  expect(response.headers.get('location')).toBe(`${publicSite}${invite}`);
});

it.each(['', '?code=expired'])(
  'returns failed callbacks to the same login page (%s)',
  async (query) => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'Expired' } });
    const response = await GET(new Request(`${publicSite}/auth/callback${query}`));
    expect(response.headers.get('location')).toBe(`${publicSite}/login?error=expired`);
  },
);

it('rejects off-site destinations after exchanging a code', async () => {
  const response = await GET(
    new Request(`${publicSite}/auth/callback?code=test&next=//evil.example.com`),
  );
  expect(response.headers.get('location')).toBe(`${publicSite}/`);
});

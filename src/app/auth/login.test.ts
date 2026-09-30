import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { signInWithOtp, signInWithOAuth, exchangeCodeForSession, requestHeaders, redirect } =
  vi.hoisted(() => ({
    signInWithOtp: vi.fn(),
    signInWithOAuth: vi.fn(),
    exchangeCodeForSession: vi.fn(),
    requestHeaders: vi.fn(),
    redirect: vi.fn(),
  }));

vi.mock('next/headers', () => ({ headers: requestHeaders }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({
    auth: { signInWithOtp, signInWithOAuth, exchangeCodeForSession },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }));

import { login } from '../actions';
import { GET } from './callback/route';

const publicSite = 'https://gather.example.com';
const protectedSite = 'https://gather-deployment.vercel.app';
const invite = `/invite/${'a'.repeat(48)}`;
const authorizeUrl = 'https://project.supabase.co/auth/v1/authorize?provider=google';

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', protectedSite);
  vi.stubEnv('VERCEL_URL', 'gather-deployment.vercel.app');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'gather.vercel.app');
  signInWithOAuth.mockResolvedValue({ data: { url: authorizeUrl }, error: null });
  redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
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

it.each(['google', 'discord'])(
  'starts %s OAuth on the browser origin without sending email',
  async (provider) => {
    const form = new FormData();
    form.set('provider', provider);
    form.set('next', invite);
    await expect(login({}, form)).rejects.toThrow('NEXT_REDIRECT');
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider,
      options: {
        redirectTo: `${publicSite}/auth/callback?next=${encodeURIComponent(invite)}`,
        skipBrowserRedirect: true,
      },
    });
    expect(redirect).toHaveBeenCalledWith(authorizeUrl);
    expect(signInWithOtp).not.toHaveBeenCalled();
  },
);

it('keeps local sign-in on localhost even with production environment URLs', async () => {
  requestHeaders.mockResolvedValue(
    new Headers({ origin: 'http://localhost:3000', host: 'localhost:3000' }),
  );
  const form = new FormData();
  form.set('provider', 'google');
  form.set('next', 'https://evil.example.com');
  await expect(login({}, form)).rejects.toThrow('NEXT_REDIRECT');
  expect(signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: {
      redirectTo: 'http://localhost:3000/auth/callback?next=%2F',
      skipBrowserRedirect: true,
    },
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
  form.set('provider', 'discord');
  await expect(login({}, form)).rejects.toThrow('NEXT_REDIRECT');
  expect(signInWithOAuth.mock.calls[0][0].options.redirectTo).toBe(
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
    expect(response.headers.get('location')).toBe(`${publicSite}/login?error=session`);
  },
);

it('rejects off-site destinations after exchanging a code', async () => {
  const response = await GET(
    new Request(`${publicSite}/auth/callback?code=test&next=//evil.example.com`),
  );
  expect(response.headers.get('location')).toBe(`${publicSite}/`);
});

it.each(['github', '', 'GOOGLE'])(
  'rejects unsupported or missing providers (%s)',
  async (provider) => {
    const form = new FormData();
    if (provider) form.set('provider', provider);
    expect(await login({}, form)).toEqual({ error: 'Choose Google or Discord to sign in.' });
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  },
);

it('reports provider initialization errors without redirecting', async () => {
  signInWithOAuth.mockResolvedValue({
    data: { url: null },
    error: { message: 'Provider is not enabled' },
  });
  const form = new FormData();
  form.set('provider', 'google');
  expect(await login({}, form)).toEqual({ error: 'Provider is not enabled' });
  expect(redirect).not.toHaveBeenCalled();
});

it('handles a missing authorization URL', async () => {
  signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });
  const form = new FormData();
  form.set('provider', 'google');
  expect(await login({}, form)).toEqual({ error: 'Unable to start sign-in. Please try again.' });
  expect(redirect).not.toHaveBeenCalled();
});

it('handles connection failures without exposing exception details', async () => {
  signInWithOAuth.mockRejectedValue(new Error('Internal connection details'));
  const form = new FormData();
  form.set('provider', 'discord');
  expect(await login({}, form)).toEqual({ error: 'Unable to start sign-in. Please try again.' });
});

it('handles provider cancellation, preserving the invitation and ignoring raw error descriptions', async () => {
  const response = await GET(
    new Request(
      `${publicSite}/auth/callback?error=access_denied&error_description=private-details&code=unused&next=${invite}`,
    ),
  );
  const destination = new URL(response.headers.get('location')!);
  expect(destination.origin).toBe(publicSite);
  expect(destination.pathname).toBe('/login');
  expect(destination.searchParams.get('error')).toBe('oauth');
  expect(destination.searchParams.get('next')).toBe(invite);
  expect(destination.href).not.toContain('private-details');
  expect(exchangeCodeForSession).not.toHaveBeenCalled();
});

it('preserves invitations when session exchange fails', async () => {
  exchangeCodeForSession.mockResolvedValue({ error: { message: 'Missing verifier' } });
  const response = await GET(new Request(`${publicSite}/auth/callback?code=test&next=${invite}`));
  const destination = new URL(response.headers.get('location')!);
  expect(destination.searchParams.get('error')).toBe('session');
  expect(destination.searchParams.get('next')).toBe(invite);
});

it('handles connection failures during code exchange', async () => {
  exchangeCodeForSession.mockRejectedValue(new Error('Connection details'));
  const response = await GET(new Request(`${publicSite}/auth/callback?code=test`));
  expect(response.headers.get('location')).toBe(`${publicSite}/login?error=session`);
});

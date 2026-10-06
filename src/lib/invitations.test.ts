import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invitationUrl } from './invitations';

const token = 'a'.repeat(48);
const publicOrigin = 'https://gather.vercel.app';
const protectedOrigin = 'https://gather-team.vercel.app';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', publicOrigin);
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'gather.vercel.app');
  vi.stubEnv('VERCEL_ENV', 'production');
});
afterEach(() => vi.unstubAllEnvs());

it('uses the public domain when the GM opens a protected alias', () => {
  expect(invitationUrl(token, protectedOrigin)).toBe(`${publicOrigin}/invite/${token}`);
});

it('prefers a configured custom domain and normalizes its trailing slash', () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://table.example.com/');
  expect(invitationUrl(token, protectedOrigin)).toBe(`https://table.example.com/invite/${token}`);
});

it.each(['', 'http://localhost:3000'])(
  'uses Vercel production domain with missing/local site configuration (%s)',
  (site) => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', site);
    expect(invitationUrl(token, protectedOrigin)).toBe(`${publicOrigin}/invite/${token}`);
  },
);

it('uses Vercel production domain instead of a stale configured Vercel alias', () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', protectedOrigin);
  expect(invitationUrl(token, protectedOrigin)).toBe(`${publicOrigin}/invite/${token}`);
});

it('keeps local invitations local even with production environment values', () => {
  expect(invitationUrl(token, 'http://localhost:3000')).toBe(
    `http://localhost:3000/invite/${token}`,
  );
});

it('does not send isolated preview invitations to production', () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://preview.example.com');
  expect(invitationUrl(token, 'https://preview-deployment.vercel.app')).toBe(
    `https://preview.example.com/invite/${token}`,
  );
});

it('fails rather than sharing an unconfigured Vercel deployment URL', () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
  expect(() => invitationUrl(token, protectedOrigin)).toThrow('Configure NEXT_PUBLIC_SITE_URL');
});

it('supports a self-hosted public origin without Vercel configuration', () => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', '');
  expect(invitationUrl(token, 'https://table.example.com')).toBe(
    `https://table.example.com/invite/${token}`,
  );
});

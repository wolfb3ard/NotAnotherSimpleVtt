import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const invite = `/invite/${'a'.repeat(48)}`;

test('a signed-out invitation opens app sign-in and retains the invitation', async ({ page }) => {
  await page.goto(invite);
  await expect(page).toHaveURL(`http://localhost:3000/login?next=${encodeURIComponent(invite)}`);
  const destination = new URL(page.url());
  expect(destination.origin).toBe('http://localhost:3000');
  expect(destination.pathname).toBe('/login');
  expect(destination.searchParams.get('next')).toBe(invite);
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

for (const provider of ['google', 'discord']) {
  test(`${provider} login redirects with a same-site callback and a PKCE cookie`, async ({
    page,
    context,
  }) => {
    let authorizeUrl: URL | undefined;
    await page.route('**/auth/v1/authorize?**', async (route) => {
      authorizeUrl = new URL(route.request().url());
      await route.fulfill({ contentType: 'text/html', body: '<h1>OAuth handoff</h1>' });
    });
    await page.goto(`/login?next=${encodeURIComponent(invite)}`);
    await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveCount(0);
    await page
      .getByRole('button', {
        name: `Continue with ${provider === 'google' ? 'Google' : 'Discord'}`,
      })
      .click();
    await expect(page.getByRole('heading', { name: 'OAuth handoff' })).toBeVisible();
    expect(authorizeUrl!.searchParams.get('provider')).toBe(provider);
    const callback = new URL(authorizeUrl!.searchParams.get('redirect_to')!);
    expect(callback.origin).toBe('http://localhost:3000');
    expect(callback.pathname).toBe('/auth/callback');
    expect(callback.searchParams.get('next')).toBe(invite);
    const cookies = await context.cookies('http://localhost:3000');
    const verifierCookie = cookies.find((cookie) =>
      cookie.name.endsWith('-auth-token-code-verifier'),
    );
    expect(verifierCookie).toBeDefined();
    const encoded = verifierCookie!.value;
    const stored = encoded.startsWith('base64-')
      ? Buffer.from(encoded.slice(7), 'base64url').toString('utf8')
      : encoded;
    const verifier = JSON.parse(stored) as string;
    expect(authorizeUrl!.searchParams.get('code_challenge_method')).toBe('s256');
    expect(authorizeUrl!.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(verifier).digest('base64url'),
    );
  });
}

test('cancelled sign-in allows a retry without losing the invitation', async ({ page }) => {
  await page.goto(
    `/auth/callback?error=access_denied&error_description=untrusted&next=${encodeURIComponent(invite)}`,
  );
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'Sign-in was cancelled or rejected. Please try again.',
  );
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Continue with Discord' })).toBeEnabled();
  await expect(page.locator('input[name="next"]')).toHaveValue(invite);
  expect(new URL(page.url()).searchParams.has('error_description')).toBe(false);
});

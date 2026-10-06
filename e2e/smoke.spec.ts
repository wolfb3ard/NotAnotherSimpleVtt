import { expect, test } from '@playwright/test';

test('public entry point renders and supports navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Not Another Simple Vtt', { exact: false }).first()).toBeVisible();
  await expect(page).toHaveTitle('Not Another Simple Vtt • Virtual Tabletop');
  if (await page.getByRole('link', { name: 'Go to sign in' }).count())
    await page.getByRole('link', { name: 'Go to sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your next adventure awaits.' })).toBeVisible();
});

test('invalid invitations fail without exposing game content', async ({ page }) => {
  await page.goto('/invite/not-a-real-invite');
  await expect(page.getByRole('heading', { name: 'Invalid invitation' })).toBeVisible();
});

test('invalid identifiers are rejected by data routes', async ({ request }) => {
  expect((await request.get('/api/games/not-a-uuid')).status()).toBe(400);
  expect((await request.get('/api/images/not-a-uuid')).status()).toBe(404);
});

import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import sharp from 'sharp';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Explicit opt-in: this suite creates real temporary users and rooms in a test project.
test.skip(
  process.env.E2E_SUPABASE !== '1' || !url || !key || !service,
  'Requires an isolated Supabase test project and E2E_SUPABASE=1.',
);

test('GM and eight players share a persistent scene, sheets, fog, and permission-filtered rolls', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  const users: string[] = [];
  const contexts: BrowserContext[] = [];
  let gameId: string | undefined;
  async function session(browser: Browser, label: string) {
    const email = `vtt-${label}-${crypto.randomUUID()}@example.com`,
      password = crypto.randomUUID();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(error?.message || 'User creation failed');
    users.push(data.user.id);
    const context = await browser.newContext();
    contexts.push(context);
    const cookies: { name: string; value: string; domain: string; path: string }[] = [];
    const client = createServerClient(url!, key!, {
      cookies: {
        getAll: () => cookies,
        setAll: (values) => {
          for (const c of values) {
            const existing = cookies.findIndex((v) => v.name === c.name);
            if (existing >= 0) cookies.splice(existing, 1);
            cookies.push({ name: c.name, value: c.value, domain: 'localhost', path: '/' });
          }
        },
      },
    });
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    await context.addCookies(cookies);
    return { page: await context.newPage(), id: data.user.id, client };
  }
  try {
    const gm = await session(browser, 'gm'),
      player = await session(browser, 'player');
    await gm.page.goto('/');
    await gm.page.getByLabel('Game name').fill('E2E adventure');
    await gm.page.getByLabel('Your display name').fill('Test GM');
    await gm.page.getByRole('button', { name: 'Create game' }).click();
    await gm.page.waitForURL('**/games/**');
    gameId = gm.page.url().split('/').pop()!;
    await gm.page.getByRole('button', { name: 'Room', exact: true }).click();
    await gm.page.getByRole('button', { name: 'Create invitation link' }).click();
    const invitation = await gm.page.getByLabel('Valid for 7 days').inputValue();
    await player.page.goto(invitation);
    await player.page.getByLabel('Your display name').fill('Test Player');
    await player.page.getByRole('button', { name: 'Accept invitation' }).click();
    await player.page.waitForURL('**/games/**');
    const spectators = await Promise.all(
      Array.from({ length: 7 }, (_, index) => session(browser, `spectator-${index}`)),
    );
    await Promise.all(
      spectators.map(async (spectator, index) => {
        const { error } = await spectator.client.rpc('accept_invite', {
          p_token: invitation.split('/').pop(),
          p_display_name: `Spectator ${index + 1}`,
        });
        if (error) throw error;
        await spectator.page.goto(`/games/${gameId}`);
        await expect(spectator.page.getByRole('status')).toContainText('Connected');
      }),
    );
    await player.page.getByRole('button', { name: 'Create character' }).click();
    await player.page.getByLabel('Name', { exact: true }).fill('Aria');
    await player.page.getByRole('button', { name: 'Create actor', exact: true }).click();
    await expect(player.page.getByLabel('Name', { exact: true })).toHaveValue('Aria');
    await player.page.getByRole('button', { name: 'Add section', exact: false }).click();
    await player.page.getByLabel('Section title').fill('Statistics');
    await player.page.getByLabel('Add field', { exact: true }).selectOption('resource');
    await player.page.getByLabel('Field label').fill('HP');
    await player.page.getByLabel('HP maximum', { exact: true }).fill('10');
    await player.page.getByLabel('HP', { exact: true }).fill('8');
    await player.page.getByRole('button', { name: 'Save sheet', exact: true }).click();
    await expect(
      player.page.getByRole('button', { name: 'Save sheet', exact: true }),
    ).toBeDisabled();
    await gm.page.getByRole('button', { name: 'Scenes', exact: true }).click();
    await gm.page.getByLabel('Scene name').fill('Forest');
    const image = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#468b50' },
    })
      .png()
      .toBuffer();
    await gm.page
      .getByLabel('Background image')
      .setInputFiles({ name: 'forest.png', mimeType: 'image/png', buffer: image });
    await gm.page.getByRole('button', { name: 'Create scene', exact: true }).click();
    await expect(gm.page.getByRole('button', { name: 'Active', exact: true })).toBeVisible();
    await gm.page.getByRole('button', { name: 'Reveal entire scene' }).click();
    await player.page.getByRole('button', { name: 'All characters', exact: false }).click();
    await player.page.getByText('Add character token to scene', { exact: true }).click();
    await player.page.getByLabel('Actor', { exact: true }).selectOption({ label: 'Aria' });
    await player.page.getByRole('button', { name: 'Place token', exact: true }).click();
    await expect
      .poll(async () => {
        const r = await player.page.request.get(`/api/games/${gameId}`);
        return (await r.json()).tokens.length;
      })
      .toBe(1);
    const state = await (await player.page.request.get(`/api/games/${gameId}`)).json();
    expect(
      (await player.page.request.get(`/api/images/${state.scenes[0].asset_id}`)).status(),
    ).toBe(404);
    // Move the token using the canvas; default map offset is 50,50 and token begins at 100,100.
    const canvas = player.page.locator('canvas').first();
    const box = (await canvas.boundingBox())!;
    await player.page.mouse.move(box.x + 150, box.y + 150);
    await player.page.mouse.down();
    await player.page.mouse.move(box.x + 220, box.y + 200, { steps: 8 });
    await player.page.mouse.up();
    await expect
      .poll(async () => {
        const r = await gm.page.request.get(`/api/games/${gameId}`);
        return (await r.json()).tokens[0].x;
      })
      .toBeCloseTo(170, 0);
    await Promise.all(
      spectators.map(async ({ page }) => {
        const current = await (await page.request.get(`/api/games/${gameId}`)).json();
        expect(current.tokens[0].x).toBeCloseTo(170, 0);
        expect(current.actors).toHaveLength(0);
      }),
    );
    await gm.page.getByRole('button', { name: 'Calibrate', exact: false }).click();
    const gmCanvas = (await gm.page.locator('canvas').first().boundingBox())!;
    await gm.page.mouse.move(gmCanvas.x + 350, gmCanvas.y + 350);
    await gm.page.mouse.down();
    await gm.page.mouse.move(gmCanvas.x + 450, gmCanvas.y + 350, { steps: 5 });
    await gm.page.mouse.up();
    await gm.page.getByLabel('Known distance').fill('5');
    await gm.page.getByRole('button', { name: 'Set scale', exact: true }).click();
    await expect
      .poll(async () => {
        const current = await (await player.page.request.get(`/api/games/${gameId}`)).json();
        return current.scenes[0].units_per_pixel;
      })
      .toBeCloseTo(0.05, 5);
    await gm.page.getByRole('button', { name: 'Dice', exact: true }).click();
    await gm.page.getByLabel('Visibility').selectOption('private');
    await gm.page.getByRole('button', { name: 'Roll dice', exact: false }).click();
    await expect(gm.page.locator('.roll-card')).toHaveCount(1);
    await player.page.getByRole('button', { name: 'Dice', exact: true }).click();
    await expect(player.page.locator('.roll-card')).toHaveCount(0);
    await expect(player.page.getByLabel('A private roll occurred')).toHaveCount(0);
    expect(
      (await (await player.page.request.get(`/api/games/${gameId}`)).json()).rollCues,
    ).toHaveLength(0);
    await player.page.getByLabel('Visibility').selectOption('private');
    await player.page.getByRole('button', { name: 'Roll dice', exact: false }).click();
    await expect(player.page.locator('.roll-card')).toHaveCount(1);
    await expect(spectators[0].page.getByLabel('A private roll occurred')).toBeVisible({
      timeout: 20000,
    });
    await expect(gm.page.locator('.roll-card')).toHaveCount(2, { timeout: 20000 });
    await Promise.all(
      spectators.map(async ({ page }) => {
        const current = await (await page.request.get(`/api/games/${gameId}`)).json();
        expect(current.rolls).toHaveLength(0);
        expect(current.rollCues).toHaveLength(1);
        expect(Object.keys(current.rollCues[0]).sort()).toEqual([
          'created_at',
          'private',
          'roll_id',
        ]);
        expect(current.rollCues[0].private).toBe(true);
      }),
    );
    await player.page.getByLabel('Visibility').selectOption('public');
    await player.page.getByRole('button', { name: 'Roll dice', exact: false }).click();
    await expect(gm.page.locator('.roll-card')).toHaveCount(3, { timeout: 20000 });
    await Promise.all(
      spectators.map(async ({ page }) => {
        await page.getByRole('button', { name: 'Dice', exact: true }).click();
        await expect(page.locator('.roll-card')).toHaveCount(1);
      }),
    );
    await player.page.reload();
    await player.page.getByRole('button', { name: 'Dice', exact: true }).click();
    await expect(player.page.locator('.roll-card')).toHaveCount(2);
    await player.page.getByRole('button', { name: 'Style', exact: true }).click();
    await player.page.getByLabel('Face color').fill('#aabbcc');
    await player.page.getByRole('button', { name: 'Save my dice' }).click();
    await expect(player.page.getByText('Dice appearance saved.')).toBeVisible();
    await expect
      .poll(async () => {
        const data = await (await gm.page.request.get(`/api/games/${gameId}`)).json();
        return data.diceStyles.find((s: { user_id: string }) => s.user_id === player.id)?.style
          .faceColor;
      })
      .toBe('#aabbcc');
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    if (gameId) {
      const { data: assets } = await admin.from('assets').select('path').eq('game_id', gameId);
      if (assets?.length) await admin.storage.from('tabletop').remove(assets.map((a) => a.path));
      const { data: scenes } = await admin.from('scenes').select('id').eq('game_id', gameId);
      for (const scene of scenes ?? []) {
        const prefix = `masked/${gameId}/${scene.id}`;
        const { data: derivatives } = await admin.storage.from('tabletop').list(prefix);
        if (derivatives?.length)
          await admin.storage
            .from('tabletop')
            .remove(derivatives.map((asset) => `${prefix}/${asset.name}`));
      }
      await admin.from('games').update({ active_scene_id: null }).eq('id', gameId);
      await admin.from('games').delete().eq('id', gameId);
    }
    for (const id of users) await admin.auth.admin.deleteUser(id);
  }
});

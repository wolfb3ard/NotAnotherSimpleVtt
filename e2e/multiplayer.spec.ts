import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import sharp from 'sharp';
import { createDndSheet, dndId, dndNumbers } from '../src/lib/dnd';
import { createMonsterSheet } from '../src/lib/srd-monsters';
import { tableSystem } from '../src/lib/table-system';
import { applySrdBuilder } from '../src/lib/srd-engine';
import { fighterBuilder } from '../src/lib/srd-test-fixtures';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Explicit opt-in: this suite creates real temporary users and rooms in a test project.
test.skip(
  process.env.E2E_SUPABASE !== '1' || !url || !key || !service,
  'Requires an isolated Supabase test project and E2E_SUPABASE=1.',
);

function sessions() {
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  const users: string[] = [];
  const contexts: BrowserContext[] = [];
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
  return { admin, users, contexts, session };
}

test('live actor updates reach an open GM token and the next attack', async ({ browser }) => {
  test.setTimeout(180000);
  const { admin, users, contexts, session } = sessions();
  const gameId = crypto.randomUUID(),
    sceneId = crypto.randomUUID(),
    assetId = crypto.randomUUID();
  try {
    const gm = await session(browser, 'gm'),
      player = await session(browser, 'player');
    const state = fighterBuilder(4);
    state.equipment.shieldId = '';
    const hero = applySrdBuilder(createDndSheet(), state);
    if (!hero.character!.items.some((i) => i.name === 'Shield'))
      hero.character!.items.push({
        id: crypto.randomUUID(),
        name: 'Shield',
        description: '',
        quantity: 1,
        rarity: 'Common',
        attuned: false,
        requiresAttunement: false,
      });
    const monster = createMonsterSheet('monster-aboleth');
    const rules = tableSystem({});
    const armor = Number(rules.armorClass(hero)),
      monsterAC = Number(rules.armorClass(monster));
    await admin
      .from('games')
      .insert({ id: gameId, gm_id: gm.id, name: 'Live rules' })
      .throwOnError();
    await admin
      .from('memberships')
      .insert(
        [gm, player].map((p) => ({
          game_id: gameId,
          user_id: p.id,
          role: p === gm ? 'gm' : 'player',
          display_name: p === gm ? 'GM' : 'Player',
        })),
      )
      .throwOnError();
    const path = `${gameId}/${assetId}.webp`;
    const image = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#555' },
    })
      .webp()
      .toBuffer();
    const upload = await admin.storage
      .from('tabletop')
      .upload(path, image, { contentType: 'image/webp' });
    if (upload.error) throw upload.error;
    await admin
      .from('assets')
      .insert({
        id: assetId,
        game_id: gameId,
        owner_id: gm.id,
        kind: 'background',
        path,
        width: 300,
        height: 300,
      })
      .throwOnError();
    await admin
      .from('scenes')
      .insert({
        id: sceneId,
        game_id: gameId,
        asset_id: assetId,
        name: 'Clearing',
        width: 300,
        height: 300,
        fog: [{ x: 0, y: 0, width: 300, height: 300, reveal: true }],
      })
      .throwOnError();
    await admin.from('games').update({ active_scene_id: sceneId }).eq('id', gameId).throwOnError();
    for (const [i, name] of ['Rowan', 'Aboleth A', 'Aboleth B'].entries()) {
      const id = crypto.randomUUID(),
        owner = i ? gm.id : player.id;
      await admin
        .from('actors')
        .insert({
          id,
          game_id: gameId,
          name,
          kind: i ? 'enemy' : 'character',
          owner_id: owner,
          sheet: i ? monster : hero,
          encounter_instance: !!i,
        })
        .throwOnError();
      await admin
        .from('tokens')
        .insert({
          scene_id: sceneId,
          game_id: gameId,
          actor_id: id,
          controller_id: owner,
          label: name,
          x: 50 + i * 70,
          y: 80,
        })
        .throwOnError();
    }
    await Promise.all(
      [gm, player].map(async (p) => {
        await p.page.goto(`/games/${gameId}`);
        await expect(p.page.locator('.connection')).toContainText('Live channel connected', {
          timeout: 30000,
        });
      }),
    );
    await gm.page.getByText('Scene tools', { exact: true }).click();
    const select = gm.page.getByLabel('Token quick actions', { exact: true });
    await select.selectOption({ label: 'Rowan' });
    const quick = gm.page.getByRole('dialog', { name: 'Rowan quick actions' });
    await expect(quick.getByText(`Armor Class: ${armor}`, { exact: true })).toBeVisible();
    await player.page.getByRole('button', { name: 'My character', exact: true }).click();
    const sheet = player.page.getByRole('dialog', { name: 'Rowan', exact: true });
    await sheet.getByRole('tab', { name: 'Inventory' }).click();
    await sheet.getByRole('button', { name: 'Equip Shield', exact: true }).first().click();
    await expect(
      sheet.getByRole('status').filter({ hasText: `AC ${armor} → ${armor + 2}` }),
    ).toBeVisible();
    await expect(quick.getByText(`Armor Class: ${armor + 2}`, { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await sheet.getByText('Character settings & tools', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Progress / level up character' }).click();
    const builder = player.page.getByRole('dialog', { name: 'SRD 5.2.1 character builder' });
    await builder.getByRole('button', { name: 'Add level 5' }).click();
    await builder.getByRole('button', { name: 'Apply and save to table' }).click();
    await expect(builder).toHaveCount(0);
    await quick.getByText('Attack / sheet rolls', { exact: true }).click();
    await quick.getByLabel('Token attack or ability').selectOption('attack:0');
    const rollAction = quick.getByRole('button', { name: 'Roll selected action' });
    await rollAction.click();
    const totalKey = dndId('weapon-total:0');
    expect(dndNumbers(hero)[dndId('pb')]).toBe(2);
    await expect
      .poll(async () => {
        const snapshot = await (await gm.page.request.get(`/api/games/${gameId}`)).json();
        return snapshot.rolls[0]?.result.modifiers[totalKey];
      })
      .toBe(dndNumbers(hero)[totalKey] + 1);
    // The roll is persisted before the client's refresh finishes. Closing
    // during that window prompts for confirmation, which Playwright dismisses.
    await expect(rollAction).toBeEnabled();
    await quick.getByLabel('Close quick actions').click();
    await expect(quick).toHaveCount(0);
    await select.selectOption({ label: 'Aboleth A' });
    const first = gm.page.getByRole('dialog', { name: 'Aboleth A quick actions' });
    await first.getByRole('button', { name: 'Open character sheet' }).click();
    const creature = gm.page.getByRole('dialog', { name: 'Aboleth A', exact: true });
    await creature.getByRole('tab', { name: 'Inventory', exact: true }).click();
    await creature.getByLabel('Item name').fill('Shield');
    await creature.getByRole('button', { name: 'Add item', exact: true }).click();
    await creature.getByRole('button', { name: 'Equip Shield', exact: true }).click();
    await expect(
      creature.getByRole('status').filter({ hasText: `AC ${monsterAC} → ${monsterAC + 2}` }),
    ).toBeVisible();
    await creature.getByLabel('Close character sheet').click();
    await expect(first.getByText(`Armor Class: ${monsterAC + 2}`, { exact: true })).toBeVisible();
    await first.getByLabel('Close quick actions').click();
    await expect(first).toHaveCount(0);
    await select.selectOption({ label: 'Aboleth B' });
    await expect(
      gm.page
        .getByRole('dialog', { name: 'Aboleth B quick actions' })
        .getByText(`Armor Class: ${monsterAC}`, { exact: true }),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await admin.storage
      .from('tabletop')
      .remove([`${gameId}/${assetId}.webp`, `masked/${gameId}/${sceneId}/0.png`]);
    await admin.from('games').update({ active_scene_id: null }).eq('id', gameId);
    await admin.from('games').delete().eq('id', gameId);
    for (const user of users) await admin.auth.admin.deleteUser(user);
  }
});

test('GM and eight players share a persistent scene, sheets, fog, and permission-filtered rolls', async ({
  browser,
}) => {
  test.setTimeout(300000);
  const { admin, users, contexts, session } = sessions();
  let gameId: string | undefined;
  try {
    const gm = await session(browser, 'gm'),
      player = await session(browser, 'player');
    await gm.page.goto('/');
    await gm.page.getByLabel('Game name').fill('E2E adventure');
    await gm.page.getByLabel('Your display name').fill('Test GM');
    await gm.page.getByRole('button', { name: 'Create game' }).click();
    await gm.page.waitForURL('**/games/**');
    gameId = gm.page.url().split('/').pop()!;
    await gm.page.getByRole('button', { name: 'Settings', exact: true }).click();
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
        await expect(spectator.page.locator('.connection')).toContainText('Live channel connected');
      }),
    );
    await player.page.getByRole('button', { name: 'Create character' }).click();
    await player.page.getByLabel('Name', { exact: true }).fill('Aria');
    await player.page.getByRole('button', { name: 'Create actor', exact: true }).click();
    const ariaSheet = player.page.getByRole('dialog', { name: 'Aria', exact: true });
    await ariaSheet.getByRole('button', { name: 'Edit character', exact: true }).click();
    await expect(ariaSheet.getByLabel('Name', { exact: true })).toHaveValue('Aria');
    await expect(ariaSheet.getByLabel('Section title')).toHaveCount(0);
    await ariaSheet.getByLabel('Hit Points', { exact: true }).fill('8');
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
    await expect(gm.page.getByText('Preparing Forest privately.')).toBeVisible();
    const draftId = (await (await gm.page.request.get(`/api/games/${gameId}`)).json()).scenes[0].id;
    const duringPrep = await (
      await player.page.request.get(`/api/games/${gameId}?prepare=${draftId}`)
    ).json();
    expect(duringPrep.scenes).toEqual([]);
    expect((await player.page.request.get(`/api/images/${draftId}?scene=1`)).status()).toBe(404);
    await gm.page.getByRole('button', { name: 'Show to players', exact: true }).click();
    await expect(gm.page.getByRole('button', { name: 'Live', exact: true })).toBeVisible();
    await gm.page.getByRole('button', { name: 'Set party spawn', exact: true }).click();
    await gm.page.getByLabel('Placement X', { exact: true }).fill('100');
    await gm.page.getByLabel('Placement Y', { exact: true }).fill('100');
    await gm.page.getByRole('button', { name: 'Confirm position', exact: true }).click();
    await expect(gm.page.getByText('Party spawn saved.', { exact: false })).toBeVisible();
    await gm.page.getByRole('button', { name: 'Reveal entire scene' }).click();
    await player.page.getByRole('button', { name: 'Close character sheet', exact: true }).click();
    const card = player.page.getByRole('button', {
      name: 'Open Aria character sheet',
      exact: true,
    });
    await card.click();
    await expect(player.page.getByRole('dialog', { name: 'Aria', exact: true })).toBeVisible();
    await player.page.getByRole('button', { name: 'Close character sheet', exact: true }).click();
    await card.focus();
    await player.page.keyboard.press('Enter');
    await expect(player.page.getByRole('dialog', { name: 'Aria', exact: true })).toBeVisible();
    await player.page.keyboard.press('Escape');
    await expect(player.page.getByRole('dialog', { name: 'Aria', exact: true })).toHaveCount(0);
    await player.page
      .getByLabel('Place character', { exact: true })
      .selectOption({ label: 'Aria' });
    await player.page.getByRole('button', { name: 'Place at party spawn', exact: true }).click();
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
    expect(state.onboarding.spawn).toBeNull();
    await expect(
      player.page.getByRole('button', { name: 'Find my character', exact: true }),
    ).toBeVisible();
    // Default map offset is 50,50; the GM-defined party spawn is 100,100.
    const canvas = player.page.locator('canvas').first();
    const box = (await canvas.boundingBox())!;
    await player.page.mouse.dblclick(box.x + 150, box.y + 150);
    await expect(player.page.getByRole('dialog', { name: 'Aria', exact: true })).toBeVisible();
    await player.page.getByRole('button', { name: 'Close character sheet', exact: true }).click();
    await player.page.mouse.click(box.x + 150, box.y + 150, { button: 'right' });
    await expect(
      player.page.getByRole('dialog', { name: 'Aria quick actions', exact: true }),
    ).toBeVisible();
    await expect(player.page.getByRole('dialog', { name: 'Aria', exact: true })).toHaveCount(0);
    await player.page.getByLabel('Quick HP', { exact: true }).fill('6');
    await expect(player.page.getByRole('status').filter({ hasText: 'Resources:' })).toHaveText(
      'Resources: Saved',
    );
    await player.page.reload();
    // Keyboard-accessible equivalent; current values survive reload.
    await player.page
      .getByLabel('Token quick actions', { exact: true })
      .selectOption({ label: 'Aria' });
    await expect(player.page.getByLabel('Quick HP', { exact: true })).toHaveValue('6');
    // Combat markers use the same sheet access, persist on reload, and stay off spectator payloads.
    await player.page.getByText('Add condition / custom marker', { exact: true }).click();
    await player.page.getByLabel('Condition name', { exact: true }).fill('Poisoned');
    await player.page.getByLabel('Condition source', { exact: true }).fill('Private trap');
    await player.page.getByRole('button', { name: 'Add condition', exact: true }).click();
    await expect(
      player.page.getByRole('button', { name: 'Remove Poisoned', exact: true }),
    ).toBeEnabled();
    await player.page.reload();
    await player.page
      .getByLabel('Token quick actions', { exact: true })
      .selectOption({ label: 'Aria' });
    await expect(
      player.page.getByRole('button', { name: 'Remove Poisoned', exact: true }),
    ).toBeVisible();
    const spectatorState = await (
      await spectators[0].page.request.get(`/api/games/${gameId}`)
    ).json();
    expect(JSON.stringify(spectatorState)).not.toContain('Private trap');
    expect(JSON.stringify(spectatorState)).not.toContain('Poisoned');
    await player.page.getByRole('button', { name: 'Remove Poisoned', exact: true }).click();
    await expect(
      player.page.getByRole('button', { name: 'Remove Poisoned', exact: true }),
    ).toHaveCount(0);
    await player.page.getByRole('button', { name: 'Close quick actions', exact: true }).click();
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
    // A whole drag is one undo entry, restored from server history after reload.
    await player.page.reload();
    await player.page.getByRole('button', { name: 'Undo: Move token', exact: true }).click();
    await expect
      .poll(async () => {
        const current = await (await player.page.request.get(`/api/games/${gameId}`)).json();
        return current.tokens[0].x;
      })
      .toBeCloseTo(100, 0);
    // Both full-scene fog controls use the same reversible path as painted rectangles.
    await gm.page.getByRole('button', { name: 'Conceal entire scene', exact: true }).click();
    await expect
      .poll(async () => {
        const current = await (await player.page.request.get(`/api/games/${gameId}`)).json();
        return current.tokens.length;
      })
      .toBe(0);
    await gm.page.getByRole('button', { name: 'Undo: Edit fog', exact: true }).click();
    await expect
      .poll(async () => {
        const current = await (await player.page.request.get(`/api/games/${gameId}`)).json();
        return current.tokens.length;
      })
      .toBe(1);
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
    const zoomSlider = gm.page.getByRole('slider', { name: /Dice zoom/ });
    await expect(zoomSlider).toHaveValue('1');
    await zoomSlider.focus();
    await zoomSlider.press('End');
    await expect(zoomSlider).toHaveValue('2');
    await gm.page.reload();
    await gm.page.getByRole('button', { name: 'Dice', exact: true }).click();
    await expect(zoomSlider).toHaveValue('2');
    await zoomSlider.focus();
    await zoomSlider.press('Home');
    await expect(zoomSlider).toHaveValue('1');
    const d20 = gm.page.getByRole('button', { name: 'd20', exact: true });
    const d6 = gm.page.getByRole('button', { name: 'd6', exact: true });
    await expect(d20).toHaveAttribute('aria-pressed', 'true');
    await d6.click();
    await expect(d6).toHaveAttribute('aria-pressed', 'true');
    await expect(d20).toHaveAttribute('aria-pressed', 'false');
    await gm.page.getByLabel('Expression', { exact: true }).fill('2d6 + 1d8');
    await expect(d6).toHaveAttribute('aria-pressed', 'true');
    await expect(gm.page.getByRole('button', { name: 'd8', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await gm.page.getByRole('button', { name: 'Advantage', exact: true }).click();
    await expect(d20).toHaveAttribute('aria-pressed', 'true');
    await expect(d6).toHaveAttribute('aria-pressed', 'false');
    await d20.click();
    await gm.page.getByLabel('Visibility').selectOption('private');
    await gm.page.getByRole('button', { name: 'Roll dice', exact: false }).click();
    await expect(gm.page.locator('.roll-card')).toHaveCount(1);
    await player.page.getByRole('button', { name: 'Dice', exact: true }).click();
    await expect(player.page.getByRole('slider', { name: /Dice zoom/ })).toHaveValue('1');
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
    await Promise.all(
      [gm, player, ...spectators].map(async ({ page }) => {
        const overlay = page.locator('.dice-overlay[aria-label^="Dice roll"]');
        await expect(overlay).toBeVisible({ timeout: 20000 });
        await expect(overlay).toHaveCSS('position', 'fixed');
        await expect(overlay).toHaveCSS('pointer-events', 'none');
        await expect(overlay).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(overlay.getByRole('button')).toHaveCount(0);
        const bounds = await overlay.boundingBox();
        expect(bounds).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
        await page.getByRole('button', { name: 'Dice', exact: true }).click();
      }),
    );
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
    // A detached dice session stays live while the party panel is active.
    await player.page.getByRole('button', { name: 'Dice', exact: true }).click();
    await player.page.getByLabel('Roll for', { exact: true }).selectOption({ label: 'Aria' });
    await player.page.getByLabel('Roll type', { exact: true }).fill('Athletics check');
    await player.page.getByLabel('Expression', { exact: true }).fill('1d20');
    await player.page.getByRole('button', { name: 'Pop out roll window' }).click();
    const rolls = player.page.getByRole('dialog', { name: 'Rolls', exact: true });
    await expect(rolls).toBeVisible();
    await rolls.getByLabel('Resize roll window').press('ArrowRight');
    const restoredWidth = (await rolls.boundingBox())!.width;
    await player.page.getByRole('button', { name: 'Party', exact: true }).click();
    await expect(rolls).toBeVisible();
    await rolls.getByRole('button', { name: 'Roll dice', exact: false }).click();
    await expect(rolls.locator('.roll-card').first()).toContainText('Aria');
    await expect(rolls.locator('.roll-card').first()).toContainText('Athletics check');
    await rolls.getByRole('button', { name: 'Maximize roll window' }).click();
    await expect(rolls).toHaveClass(/is-maximized/);
    await player.page.reload();
    await expect(rolls).toHaveClass(/is-maximized/);
    await rolls.getByRole('button', { name: 'Restore roll window' }).click();
    await expect(rolls).toHaveCSS('width', `${restoredWidth}px`);
    await rolls.getByRole('button', { name: 'Dock roll window' }).click();
    await expect(rolls).toHaveCount(0);
    await player.page.getByRole('button', { name: 'Party', exact: true }).click();
    await card.click();
    player.page.once('dialog', (dialog) => dialog.accept());
    await player.page.getByRole('button', { name: 'Delete character', exact: true }).click();
    await expect(card).toHaveCount(0);
    const afterDeletion = await (await player.page.request.get(`/api/games/${gameId}`)).json();
    expect(afterDeletion.tokens).toHaveLength(0);
    expect(afterDeletion.rolls[0]).toMatchObject({
      actor_id: null,
      actor_name: 'Aria',
      roll_type: 'Athletics check',
    });
    await player.page.reload();
    await player.page.getByRole('button', { name: 'Dice', exact: true }).click();
    await expect(player.page.locator('.roll-card').first()).toContainText('Aria');
    await expect(player.page.locator('.roll-card').first()).toContainText('Athletics check');
    // Real RPC persistence plus native-dialog level-up, not a mocked save.
    const createdBuilder = await player.client.rpc('mutate_game', {
      p_game: gameId,
      p_command: 'actor_create',
      p: {
        name: 'Builder hero',
        kind: 'character',
        owner_id: player.id,
        sheet: applySrdBuilder(createDndSheet(), fighterBuilder()),
      },
    });
    if (createdBuilder.error) throw createdBuilder.error;
    await player.page.reload();
    await player.page
      .getByRole('button', { name: 'Open Builder hero character sheet', exact: true })
      .click();
    await player.page
      .getByRole('button', { name: 'Progress / level up character', exact: true })
      .click();
    const builder = player.page.getByRole('dialog', {
      name: 'SRD 5.2.1 character builder',
      exact: true,
    });
    await expect(builder).toBeVisible();
    await builder.getByRole('button', { name: 'Add level 2', exact: true }).click();
    await builder
      .getByRole('button', { name: 'Apply builder to unsaved sheet', exact: true })
      .click();
    await expect(builder).toHaveCount(0);
    await player.page.getByRole('button', { name: 'Save sheet', exact: true }).click();
    await expect(
      player.page.getByRole('button', { name: 'Save sheet', exact: true }),
    ).toBeDisabled();
    await player.page.reload();
    await player.page
      .getByRole('button', { name: 'Open Builder hero character sheet', exact: true })
      .click();
    await expect(player.page.getByLabel('Level', { exact: true })).toHaveValue('2');
    await expect(player.page.getByLabel('Level', { exact: true })).toBeDisabled();
    const builderSnapshot = await (await player.page.request.get(`/api/games/${gameId}`)).json();
    expect(
      builderSnapshot.actors.find((a: { name: string }) => a.name === 'Builder hero').sheet
        .character.builder.levels,
    ).toHaveLength(2);
    // Phase 2: library-to-board, private monster sheets and independent uses.
    await gm.page.getByRole('button', { name: 'Party', exact: true }).click();
    await gm.page.getByText('SRD monsters · Add independent creatures', { exact: true }).click();
    const library = gm.page.getByRole('region', { name: 'GM monster library' });
    await library.getByLabel('Search monsters', { exact: true }).fill('Incubus');
    await library.getByLabel('Monster', { exact: true }).selectOption('monster-incubus');
    await library.getByLabel('Number of creatures', { exact: true }).fill('2');
    await library.getByRole('button', { name: 'Add creatures', exact: true }).click();
    await expect(library.getByRole('status')).toContainText(
      '2 independent creature(s) added hidden',
    );
    await gm.page.reload();
    await gm.page
      .getByRole('button', { name: 'Open Incubus 1 character sheet', exact: true })
      .click();
    const monsterSheet = gm.page.getByRole('dialog', { name: 'Incubus 1', exact: true });
    await expect(monsterSheet.getByRole('heading', { name: 'Dream', exact: true })).toBeVisible();
    await monsterSheet.getByRole('button', { name: 'Spend Dream use', exact: true }).click();
    await expect(gm.page.getByRole('status').filter({ hasText: 'Resources:' })).toHaveCount(0);
    await monsterSheet
      .getByRole('button', { name: 'Roll Restless Touch · Attack', exact: true })
      .click();
    await expect
      .poll(async () => {
        const current = await (await gm.page.request.get(`/api/games/${gameId}`)).json();
        return current.rolls[0]?.visibility;
      })
      .toBe('private');
    const monsters = await (await gm.page.request.get(`/api/games/${gameId}`)).json();
    const first = monsters.actors.find((a: { name: string }) => a.name === 'Incubus 1');
    const second = monsters.actors.find((a: { name: string }) => a.name === 'Incubus 2');
    const uses = (actor: {
      sheet: { sections: { fields: { label: string; value: number }[] }[] };
    }) =>
      actor.sheet.sections.flatMap((s) => s.fields).find((f) => f.label === 'Dream uses')?.value;
    expect(uses(first)).toBe(0);
    expect(uses(second)).toBe(1);
    expect(
      monsters.tokens
        .filter((t: { actor_id: string; hidden: boolean }) =>
          [first.id, second.id].includes(t.actor_id),
        )
        .every((t: { hidden: boolean }) => t.hidden),
    ).toBe(true);
    const privatePlayerState = await (await player.page.request.get(`/api/games/${gameId}`)).json();
    expect(
      privatePlayerState.actors.some((a: { id: string }) => [first.id, second.id].includes(a.id)),
    ).toBe(false);
    expect(
      privatePlayerState.tokens.some((t: { actor_id: string }) =>
        [first.id, second.id].includes(t.actor_id),
      ),
    ).toBe(false);
    expect(
      privatePlayerState.rolls.some((r: { actor_id: string }) => r.actor_id === first.id),
    ).toBe(false);
    // Scene-scoped initiative: private automatic rolls, omitted enemies and
    // authoritative turns survive refresh without granting players advancement.
    const builtHero = builderSnapshot.actors.find(
      (a: { name: string }) => a.name === 'Builder hero',
    );
    const placement = await player.client.rpc('place_actor_token', {
      p_game: gameId,
      p_actor: builtHero.id,
      p_scene: monsters.game.active_scene_id,
    });
    if (placement.error) throw placement.error;
    await gm.page.reload();
    await gm.page.getByRole('button', { name: 'Encounter', exact: true }).click();
    const tracker = gm.page.getByRole('region', { name: 'Encounter tracker' });
    for (const name of ['Builder hero', 'Incubus 1', 'Incubus 2'])
      await tracker
        .getByRole('checkbox', { name: `Include ${name} in encounter`, exact: true })
        .check();
    await tracker.getByLabel('Manual initiative for Builder hero', { exact: true }).fill('-100000');
    await tracker.getByLabel('Manual initiative for Incubus 1', { exact: true }).fill('99999');
    await tracker.getByRole('button', { name: 'Start encounter', exact: true }).click();
    await expect(tracker.getByRole('button', { name: 'Next turn', exact: true })).toBeEnabled();
    const started = await (await player.page.request.get(`/api/games/${gameId}`)).json();
    expect(started.encounter.participants.map((p: { label: string }) => p.label)).toEqual([
      'Builder hero',
    ]);
    expect(started.encounter.active_token_id).toBeNull();
    expect(JSON.stringify(started.encounter)).not.toContain(first.id);
    expect(JSON.stringify(started.encounter)).not.toContain(second.id);
    expect(
      started.rolls.some((r: { roll_type: string }) => r.roll_type === 'Encounter initiative'),
    ).toBe(false);
    await tracker.getByRole('button', { name: 'Next turn', exact: true }).click();
    await tracker.getByRole('button', { name: 'Next turn', exact: true }).click();
    await expect(player.page.locator('.encounter-turn')).toContainText('Your turn');
    await player.page.reload();
    await expect(player.page.locator('.encounter-turn')).toContainText('Your turn');
    await player.page.getByRole('button', { name: 'Encounter', exact: true }).click();
    const playerTracker = player.page.getByRole('region', { name: 'Encounter tracker' });
    await expect(playerTracker).not.toContainText('Incubus');
    await expect(playerTracker.getByRole('button', { name: 'Next turn', exact: true })).toHaveCount(
      0,
    );
    await tracker.getByRole('button', { name: 'Pause encounter', exact: true }).click();
    await expect(player.page.locator('.encounter-turn')).toContainText('Encounter paused');
    await tracker.getByRole('button', { name: 'Resume encounter', exact: true }).click();
    await expect(player.page.locator('.encounter-turn')).toContainText('Your turn');
    gm.page.once('dialog', (dialog) => dialog.accept());
    await tracker.getByRole('button', { name: 'End encounter', exact: true }).click();
    await expect(player.page.locator('.encounter-turn')).toContainText('Encounter ended');
    // Selected-token attacks and HP need no sidebar/sheet hopping; private rolls stay private.
    await player.page.getByLabel('Quick roll visibility', { exact: true }).selectOption('private');
    await player.page
      .getByLabel('Token quick actions', { exact: true })
      .selectOption({ label: 'Builder hero' });
    const quick = player.page.getByRole('dialog', {
      name: 'Builder hero quick actions',
      exact: true,
    });
    await quick.getByText('Attack / sheet rolls', { exact: true }).click();
    await quick.getByLabel('Token attack or ability').selectOption({ label: 'Spell attack' });
    await quick.getByRole('button', { name: 'Roll selected action', exact: true }).click();
    await expect
      .poll(async () => {
        const current = await (await player.page.request.get(`/api/games/${gameId}`)).json();
        return current.rolls[0]?.actor_id === builtHero.id && current.rolls[0]?.visibility;
      })
      .toBe('private');
    const hiddenRoll = (await (await player.page.request.get(`/api/games/${gameId}`)).json())
      .rolls[0];
    const spectatorRolls = (
      await (await spectators[0].page.request.get(`/api/games/${gameId}`)).json()
    ).rolls;
    expect(spectatorRolls.some((r: { id: string }) => r.id === hiddenRoll.id)).toBe(false);
    const hp = quick.getByLabel('Quick Hit Points', { exact: true });
    const nextHp = Math.max(0, Number(await hp.inputValue()) - 1);
    await hp.fill(String(nextHp));
    await expect(quick.getByRole('status').filter({ hasText: 'Resources:' })).toHaveText(
      'Resources: Saved',
    );
    const assistance = quick
      .locator('details')
      .filter({
        has: quick.getByText('Casting, rests & damage', { exact: true }),
      })
      .last();
    await quick.getByText('Casting, rests & damage', { exact: true }).click();
    await assistance.getByLabel('Assistance', { exact: true }).selectOption('damage');
    await assistance.getByLabel('Final damage to Builder hero').fill('1');
    await assistance.getByRole('button', { name: 'Preview damage', exact: true }).click();
    await expect(assistance.getByLabel('Assistance preview')).toContainText(
      `Hit Points: ${nextHp} → ${nextHp - 1}`,
    );
    await expect(hp).toHaveValue(String(nextHp));
    await assistance.getByRole('button', { name: 'Confirm damage', exact: true }).click();
    await expect(hp).toHaveValue(String(nextHp - 1));
    await assistance.getByRole('button', { name: 'Undo last assisted damage' }).click();
    await expect(hp).toHaveValue(String(nextHp));
    await expect(
      player.page.getByRole('dialog', { name: 'Builder hero', exact: true }),
    ).toHaveCount(0);
    await expect(player.page.getByRole('button', { name: 'Encounter', exact: true })).toHaveClass(
      'active',
    );
    // Epic 09: shared grid, discoverable help, optional snap and a remembered camera.
    await player.page.getByRole('button', { name: 'Close quick actions', exact: true }).click();
    await gm.page.getByRole('button', { name: 'Grid settings', exact: true }).click();
    await gm.page.getByLabel('Show grid to everyone', { exact: true }).check();
    await gm.page.getByLabel('Cell size (pixels)', { exact: true }).fill('50');
    await gm.page.getByLabel('Grid origin X', { exact: true }).fill('10');
    await gm.page.getByLabel('Grid origin Y', { exact: true }).fill('20');
    await gm.page.getByRole('button', { name: 'Apply grid', exact: true }).click();
    const snap = player.page.getByRole('button', { name: 'Snap to grid', exact: true });
    await expect(snap).toBeEnabled();
    const wasSnapping = await snap.getAttribute('aria-pressed');
    await snap.click();
    await expect(snap).toHaveAttribute('aria-pressed', wasSnapping === 'true' ? 'false' : 'true');
    const gridState = await (await player.page.request.get(`/api/games/${gameId}`)).json();
    expect(
      gridState.scenes.find((s: { id: string }) => s.id === gridState.game.active_scene_id).grid,
    ).toEqual({ enabled: true, size: 50, origin_x: 10, origin_y: 20 });
    await expect(
      player.page.getByRole('button', { name: 'Grid settings', exact: true }),
    ).toHaveCount(0);
    await player.page.getByText('Map help & shortcuts', { exact: true }).click();
    await expect(player.page.locator('.map-help-content')).toContainText('Euclidean');
    await player.page.getByText('Map help & shortcuts', { exact: true }).click();
    await player.page.getByRole('button', { name: 'Find my character', exact: true }).click();
    await player.page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const cameraKey = `vtt-viewport:v1:${player.id}:${gameId}:${gridState.game.active_scene_id}`;
    const camera = await player.page.evaluate((key) => localStorage.getItem(key), cameraKey);
    expect(camera).not.toBeNull();
    await player.page.reload();
    expect(await player.page.evaluate((key) => localStorage.getItem(key), cameraKey)).toBe(camera);
    await expect(player.page.locator('.canvas-bottom')).toContainText('120%');
    await player.page.getByRole('button', { name: 'Fit map / Reset view', exact: true }).click();
    // Epic 10: ephemeral pointing, explicit camera consent, tabs and offline/rejoin.
    await gm.page.getByRole('button', { name: 'Scenes', exact: true }).click();
    await gm.page.getByRole('button', { name: 'Reveal entire scene', exact: true }).click();
    await gm.page.getByText('Attention coordinates & policy', { exact: true }).click();
    await gm.page.getByLabel('Attention X', { exact: true }).fill('100');
    await gm.page.getByLabel('Attention Y', { exact: true }).fill('100');
    await gm.page.getByRole('button', { name: 'Ping coordinates', exact: true }).click();
    await expect(
      player.page.getByRole('img', { name: 'Test GM ping at map 100, 100', exact: true }),
    ).toBeVisible({ timeout: 10000 });
    const beforeFollow = await player.page.evaluate((key) => localStorage.getItem(key), cameraKey);
    await gm.page
      .getByRole('button', { name: 'Request camera at coordinates', exact: true })
      .click();
    await expect(
      player.page.getByRole('button', { name: 'Follow camera request', exact: true }),
    ).toBeVisible({ timeout: 10000 });
    expect(await player.page.evaluate((key) => localStorage.getItem(key), cameraKey)).toBe(
      beforeFollow,
    );
    await player.page.getByRole('button', { name: 'Decline camera request', exact: true }).click();
    expect(await player.page.evaluate((key) => localStorage.getItem(key), cameraKey)).toBe(
      beforeFollow,
    );
    await expect(
      player.page.getByRole('img', { name: 'Test GM ping at map 100, 100', exact: true }),
    ).toHaveCount(0, { timeout: 10000 });
    await gm.page
      .getByRole('button', { name: 'Request camera at coordinates', exact: true })
      .click();
    await player.page
      .getByRole('button', { name: 'Follow camera request', exact: true })
      .click({ timeout: 10000 });
    await expect
      .poll(() => player.page.evaluate((key) => localStorage.getItem(key), cameraKey))
      .not.toBe(beforeFollow);
    const extraTab = await player.page.context().newPage();
    await extraTab.goto(`/games/${gameId}`);
    await gm.page.getByText(/^Who is online/).click();
    await expect(gm.page.locator('.room-presence')).toContainText('2 tab(s)', { timeout: 10000 });
    await extraTab.close();
    await player.page.context().setOffline(true);
    await expect(player.page.locator('.connection')).toContainText('Offline');
    await expect(gm.page.locator('.room-presence')).toContainText('Test Player · Offline', {
      timeout: 20000,
    });
    await player.page.context().setOffline(false);
    await expect(gm.page.locator('.room-presence')).toContainText('Test Player · Online', {
      timeout: 10000,
    });
    // Epic 11: private drafts never enter snapshots; sharing/reload/dismissal reconcile.
    await player.page.getByText('Spell templates', { exact: true }).click();
    await player.page.getByLabel('Template shape', { exact: true }).selectOption('cone');
    await player.page.getByLabel('Template x', { exact: true }).fill('100');
    await player.page.getByLabel('Template y', { exact: true }).fill('100');
    await player.page.getByLabel('Template size', { exact: true }).fill('15');
    await player.page.getByLabel('Template rotation', { exact: true }).fill('90');
    await player.page.getByRole('button', { name: 'Preview privately', exact: true }).click();
    await expect(player.page.locator('.tactical-template-overlay')).toContainText('Only you');
    const privateState = await (await gm.page.request.get(`/api/games/${gameId}`)).json();
    expect(privateState.tacticalTemplates).toEqual([]);
    await player.page
      .getByRole('button', { name: 'Share template with everyone', exact: true })
      .click();
    await expect(gm.page.locator('.tactical-template-overlay')).toContainText(
      'Test Player · Shared',
    );
    await player.page.reload();
    await expect(player.page.locator('.tactical-template-overlay')).toContainText('15 ft length');
    await player.page.getByText('Spell templates', { exact: true }).click();
    await player.page
      .getByRole('button', { name: 'Move/edit Test Player template', exact: true })
      .click();
    await player.page.getByLabel('Template x', { exact: true }).fill('120');
    const unmoved = await (await gm.page.request.get(`/api/games/${gameId}`)).json();
    expect(unmoved.tacticalTemplates[0].area.x).toBe(100);
    await player.page
      .getByRole('button', { name: 'Share template with everyone', exact: true })
      .click();
    await expect
      .poll(async () => {
        const state = await (await gm.page.request.get(`/api/games/${gameId}`)).json();
        return state.tacticalTemplates[0]?.area.x;
      })
      .toBe(120);
    await player.page
      .getByRole('button', { name: 'Dismiss Test Player shared template', exact: true })
      .click();
    await expect(gm.page.locator('.tactical-template-overlay')).not.toContainText(
      'Test Player · Shared',
    );
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

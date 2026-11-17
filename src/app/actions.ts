'use server';

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';
import sharp from 'sharp';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { commandSchemas, type Command } from '@/lib/commands';
import { rollDice } from '@/lib/dice';
import { numericFields, sheetSchema } from '@/lib/sheets';
import { diceStyleSchema } from '@/lib/dice-style';
import { invitationUrl } from '@/lib/invitations';
import { authCallbackPath, authNextCookie, safeAuthNext } from '@/lib/auth-redirect';
import { createMonsterSheet, monsterById } from '@/lib/srd-monsters';
import { initiativeTokenIds } from '@/lib/encounter-commands';
import { initiativeInput } from '@/lib/initiative';

const uuid = z.string().uuid();
const title = z.string().trim().min(1).max(100);
function message(error: unknown) {
  return error instanceof z.ZodError
    ? error.issues[0].message
    : error instanceof Error
      ? error.message
      : 'Request failed. Please try again.';
}
export async function login(
  _state: { error?: string },
  form: FormData,
): Promise<{ error?: string }> {
  const provider = z.enum(['google', 'discord']).safeParse(form.get('provider'));
  if (!provider.success) return { error: 'Choose Google or Discord to sign in.' };
  const safeNext = safeAuthNext(form.get('next'));
  let authorizeUrl: string;
  try {
    const db = await supabaseServer();
    const headerList = await headers();
    const host = headerList.get('x-forwarded-host') || headerList.get('host');
    const proto = headerList.get('x-forwarded-proto') || 'https';
    // Keep the PKCE callback on the browser's host, where its verifier cookie lives.
    // Deployment-specific Vercel URLs can require Vercel authentication.
    const origin = headerList.get('origin') || (host ? `${proto}://${host}` : undefined);
    const site = origin || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const callback = new URL(authCallbackPath, site);
    const { data, error } = await db.auth.signInWithOAuth({
      provider: provider.data,
      options: {
        // Query parameters can miss Supabase's exact callback allowlist and fall
        // back to a protected Site URL. Keep the destination in a cookie instead.
        redirectTo: callback.href,
        skipBrowserRedirect: true,
      },
    });
    if (error) return { error: error.message };
    if (!data.url) return { error: 'Unable to start sign-in. Please try again.' };
    const store = await cookies();
    store.set(authNextCookie, safeNext, {
      httpOnly: true,
      sameSite: 'lax',
      secure: callback.protocol === 'https:',
      path: authCallbackPath,
      maxAge: 600,
    });
    authorizeUrl = data.url;
  } catch {
    return { error: 'Unable to start sign-in. Please try again.' };
  }
  redirect(authorizeUrl);
}

export async function logout() {
  const db = await supabaseServer();
  await db.auth.signOut();
  redirect('/login');
}

export async function createGame(form: FormData) {
  let gameId: string;
  try {
    const db = await supabaseServer();
    const { data, error } = await db.rpc('create_game', {
      p_name: title.parse(form.get('name')),
      p_display_name: z.string().trim().min(1).max(80).parse(form.get('display_name')),
    });
    if (error) throw new Error(error.message);
    gameId = data;
  } catch (error) {
    return { error: message(error) };
  }
  redirect(`/games/${gameId}`);
}

export async function acceptInvite(form: FormData) {
  let gameId: string;
  try {
    const db = await supabaseServer();
    const { data, error } = await db.rpc('accept_invite', {
      p_token: z
        .string()
        .regex(/^[a-f0-9]{48}$/)
        .parse(form.get('token')),
      p_display_name: z.string().trim().min(1).max(80).parse(form.get('display_name')),
    });
    if (error) throw new Error(error.message);
    gameId = data;
  } catch (error) {
    return { error: message(error) };
  }
  redirect(`/games/${gameId}`);
}

export async function mutate(
  gameId: string,
  command: Command,
  payload: unknown,
): Promise<{ error?: string; data?: Record<string, string> }> {
  try {
    uuid.parse(gameId);
    if (!Object.hasOwn(commandSchemas, command)) throw new Error('Unknown command.');
    const validated = commandSchemas[command].parse(payload);
    const ownership =
      command === 'actor_owner' ? commandSchemas.actor_owner.parse(validated) : null;
    const deletion =
      command === 'actor_delete' ? commandSchemas.actor_delete.parse(validated) : null;
    const db = await supabaseServer();
    if (command === 'token_place' || command === 'party_spawn' || command === 'scene_calibrate') {
      const { data, error } = await db.rpc('onboarding_command', {
        p_game: gameId,
        p_command: command,
        p: validated,
      });
      if (error) throw new Error(error.message);
      return { data };
    }
    if (command === 'encounter') {
      const request = commandSchemas.encounter.parse(validated);
      const ids = initiativeTokenIds(request);
      if (!ids.length) {
        const { data, error } = await db.rpc('encounter_command', { p_game: gameId, p: request });
        if (error) throw new Error(error.message);
        return { data };
      }
      // A lost-response retry must work even after its source actor was deleted,
      // changed, or moved out of the active scene. Never reroll a committed batch.
      const previous = await db.rpc('encounter_receipt', { p_game: gameId, p: request });
      if (previous.error) throw new Error(previous.error.message);
      if (previous.data) return { data: previous.data };
      const {
        data: { user },
      } = await db.auth.getUser();
      if (!user) throw new Error('Login required.');
      const { data: game } = await db
        .from('games')
        .select('id,gm_id,active_scene_id,dice')
        .eq('id', gameId)
        .single();
      if (!game || game.gm_id !== user.id) throw new Error('GM required.');
      if (game.active_scene_id !== request.scene_id)
        throw new Error('Active scene changed. Reload the encounter.');
      const tokens = await db
        .from('tokens')
        .select('*')
        .eq('game_id', gameId)
        .eq('scene_id', request.scene_id)
        .in('id', ids);
      if (tokens.error || tokens.data?.length !== ids.length)
        throw new Error('Selected tokens are unavailable.');
      const actorIds = [...new Set(tokens.data.map((t) => t.actor_id))];
      const actors = await db.from('actors').select('*').eq('game_id', gameId).in('id', actorIds);
      if (actors.error) throw new Error('Unable to load initiative sources.');
      const packets = ids.map((tokenId) => {
        const token = tokens.data.find((t) => t.id === tokenId)!;
        const actor = actors.data?.find((a) => a.id === token.actor_id);
        if (!actor) throw new Error('Initiative sheet unavailable.');
        const input = initiativeInput(actor.sheet);
        return {
          token_id: token.id,
          token_revision: token.revision,
          actor_id: actor.id,
          actor_revision: actor.revision,
          roll_id: crypto.randomUUID(),
          expression: input.expression,
          result: rollDice(input.expression, game.dice, input.fields),
        };
      });
      const { data, error } = await supabaseAdmin().rpc('commit_encounter_rolls', {
        p_user: user.id,
        p_game: gameId,
        p: request,
        p_rolls: packets,
      });
      if (error) throw new Error(error.message);
      return { data };
    }
    if (command === 'creature_add') {
      const request = commandSchemas.creature_add.parse(validated);
      const source = request.source;
      const monster = source.kind === 'srd' ? monsterById.get(source.monster_id) : undefined;
      if (source.kind === 'srd' && !monster) throw new Error('Unknown SRD 5.2.1 monster.');
      const { data, error } = await db.rpc('create_encounter_creatures', {
        p_game: gameId,
        p_scene: request.scene_id,
        p_operation: request.operation_id,
        p_count: request.count,
        p_source: source.kind === 'actor' ? source.actor_id : null,
        p_revision: source.kind === 'actor' ? source.revision : null,
        p_name: monster?.name ?? null,
        p_sheet: monster ? sheetSchema.parse(createMonsterSheet(monster.id)) : null,
      });
      if (error) throw new Error(error.message);
      return { data };
    }
    if (command === 'actor_combat') {
      const request = commandSchemas.actor_combat.parse(validated);
      const { data, error } = await db.rpc('save_actor_combat', {
        p_game: gameId,
        p_actor: request.id,
        p_revision: request.revision,
        p_operation: request.operation_id,
        p_state: request.state,
      });
      if (error) throw new Error(error.message);
      return { data };
    }
    const appearance =
      command === 'actor_appearance' ? commandSchemas.actor_appearance.parse(validated) : null;
    const placement =
      command === 'token_create' ? commandSchemas.token_create.parse(validated) : null;
    const resources =
      command === 'actor_resources' ? commandSchemas.actor_resources.parse(validated) : null;
    const { data, error } = resources
      ? await db.rpc('adjust_actor_resources', {
          p_game: gameId,
          p_actor: resources.id,
          p_revision: resources.revision,
          p_operation: resources.operation_id,
          p_changes: resources.changes,
        })
      : appearance
        ? await db.rpc('save_actor_appearance', {
            p_game: gameId,
            p_actor: appearance.id,
            p_asset: appearance.asset_id,
            p_ring: appearance.ring,
            p_revision: appearance.revision,
          })
        : placement
          ? await db.rpc('place_actor_token', {
              p_game: gameId,
              p_actor: placement.actor_id,
              p_scene: placement.scene_id,
            })
          : deletion
            ? await db.rpc('delete_actor', {
                p_game: gameId,
                p_actor: deletion.id,
                p_revision: deletion.revision,
              })
            : ownership
              ? await db.rpc('transfer_actor_owner', {
                  p_game: gameId,
                  p_actor: ownership.actor_id,
                  p_owner: ownership.owner_id,
                  p_revision: ownership.revision,
                })
              : await db.rpc(command.startsWith('tabletop_') ? 'tabletop_command' : 'mutate_game', {
                  p_game: gameId,
                  p_command: command,
                  p: validated,
                });
    if (error) throw new Error(error.message);
    if (command === 'invite' && data?.token) {
      const headerList = await headers();
      const host = headerList.get('x-forwarded-host') || headerList.get('host');
      const proto = headerList.get('x-forwarded-proto') || 'https';
      const origin = headerList.get('origin') || (host ? `${proto}://${host}` : undefined);
      if (!origin) throw new Error('Unable to determine the app origin. Please try again.');
      return { data: { ...data, url: invitationUrl(data.token, origin) } };
    }
    return { data };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function uploadAsset(form: FormData): Promise<{ error?: string; id?: string }> {
  try {
    const gameId = uuid.parse(form.get('game_id'));
    const kind = z.enum(['background', 'token']).parse(form.get('kind'));
    const file = form.get('file');
    if (!(file instanceof File) || file.size < 1 || file.size > 4 * 1024 * 1024)
      throw new Error('Choose an image up to 4 MB.');
    const db = await supabaseServer();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) throw new Error('Login required.');
    const { data: game } = await db.from('games').select('gm_id').eq('id', gameId).single();
    if (!game || (kind === 'background' && game.gm_id !== user.id))
      throw new Error('Upload access denied.');
    const input = Buffer.from(await file.arrayBuffer());
    const processor = sharp(input, { limitInputPixels: 4096 * 4096, animated: false });
    const metadata = await processor.metadata();
    if (
      !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 4096 ||
      metadata.height > 4096 ||
      (metadata.pages ?? 1) > 1
    )
      throw new Error('Use a static PNG, JPEG, or WebP image, at most 4096 × 4096 pixels.');
    const { data: bytes, info } = await processor
      .rotate()
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    const id = crypto.randomUUID();
    const path = `${gameId}/${id}.webp`;
    const admin = supabaseAdmin();
    const { error: storageError } = await admin.storage
      .from('tabletop')
      .upload(path, bytes, { contentType: 'image/webp' });
    if (storageError) throw new Error('Image upload failed.');
    const { error } = await admin.from('assets').insert({
      id,
      game_id: gameId,
      owner_id: user.id,
      kind,
      path,
      width: info.width,
      height: info.height,
    });
    if (error) {
      await admin.storage.from('tabletop').remove([path]);
      throw new Error('Unable to register image.');
    }
    return { id };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function roll(gameId: string, payload: unknown) {
  try {
    uuid.parse(gameId);
    const input = z
      .object({
        id: uuid,
        actor_id: uuid.nullable(),
        expression: z.string().min(1).max(500),
        roll_type: z.string().trim().min(1).max(160).default('Manual roll'),
        visibility: z.enum(['public', 'private']),
      })
      .parse(payload);
    const db = await supabaseServer();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) throw new Error('Login required.');
    const { data: game } = await db.from('games').select('*').eq('id', gameId).single();
    if (!game) throw new Error('Game access denied.');
    let fields = {};
    if (input.actor_id) {
      const { data: actor } = await db
        .from('actors')
        .select('*')
        .eq('id', input.actor_id)
        .eq('game_id', gameId)
        .single();
      // Sheet access and character control are separate; record_roll checks control again.
      if (!actor) throw new Error('Character sheet access denied.');
      fields = numericFields(sheetSchema.parse(actor.sheet));
    }
    const result = rollDice(input.expression, game.dice, fields);
    const admin = supabaseAdmin();
    const { error } = await admin.rpc('record_roll', {
      p_user: user.id,
      p_game: gameId,
      p_id: input.id,
      p_actor: input.actor_id,
      p_expression: input.expression,
      p_visibility: input.visibility,
      p_result: result,
      p_roll_type: input.roll_type,
    });
    if (error) throw new Error(error.message);
    return { success: true, result };
  } catch (error) {
    return { error: message(error) };
  }
}

export async function saveDiceStyle(payload: unknown): Promise<{ error?: string; success?: true }> {
  try {
    const style = diceStyleSchema.parse(payload);
    const db = await supabaseServer();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) throw new Error('Login required.');
    const { error } = await db.rpc('save_dice_style', { p_style: style });
    if (error) throw new Error(error.message);
    return { success: true };
  } catch (error) {
    return { error: message(error) };
  }
}

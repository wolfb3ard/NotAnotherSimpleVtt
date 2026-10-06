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
    const db = await supabaseServer();
    const { data, error } = await db.rpc('mutate_game', {
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

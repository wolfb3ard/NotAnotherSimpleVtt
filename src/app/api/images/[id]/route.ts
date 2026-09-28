import { configured, supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { maskMap } from '@/lib/mask';
import { z } from 'zod';
import type { FogRect } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response('Not found', { status: 404 });
  if (!configured()) return new Response('Database is not configured', { status: 503 });
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return new Response('Login required', { status: 401 });
  const url = new URL(request.url);
  const sceneRequest = url.searchParams.get('scene') === '1';
  let path: string;
  let mask: { width: number; height: number; fog: FogRect[] } | undefined;
  let maskedPath: string | undefined;
  const admin = supabaseAdmin();
  if (sceneRequest) {
    const { data: scene } = await db.from('scenes').select('*').eq('id', id).single();
    if (!scene) return new Response('Not found', { status: 404 });
    const { data: game } = await db.from('games').select('gm_id').eq('id', scene.game_id).single();
    if (!game) return new Response('Not found', { status: 404 });
    const { data: asset } = await admin
      .from('assets')
      .select('path')
      .eq('id', scene.asset_id)
      .single();
    if (!asset) return new Response('Not found', { status: 404 });
    path = asset.path;
    if (game.gm_id !== user.id || url.searchParams.get('preview') === '1') {
      mask = scene;
      maskedPath = `masked/${scene.game_id}/${scene.id}/${scene.revision}.webp`;
    }
  } else {
    const { data: asset } = await db.from('assets').select('*').eq('id', id).single();
    if (!asset) return new Response('Not found', { status: 404 });
    path = asset.path;
  }
  const headers = {
    'Content-Type': 'image/webp',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  // Always authorize against the current scene before reading a shared derivative.
  // Client-supplied revision parameters are deliberately ignored by this route.
  if (maskedPath) {
    const { data: cached } = await admin.storage.from('tabletop').download(maskedPath);
    if (cached) return new Response(new Uint8Array(await cached.arrayBuffer()), { headers });
  }
  const { data, error } = await admin.storage.from('tabletop').download(path);
  if (error || !data) return new Response('Image unavailable', { status: 503 });
  try {
    let bytes: Buffer = Buffer.from(await data.arrayBuffer());
    if (mask) bytes = await maskMap(bytes, mask.width, mask.height, mask.fog);
    if (maskedPath && bytes.length <= 6 * 1024 * 1024) {
      // Concurrent requests may create the same immutable revision; conflicts are harmless.
      await admin.storage
        .from('tabletop')
        .upload(maskedPath, bytes, { contentType: 'image/webp', upsert: false });
    }
    return new Response(new Uint8Array(bytes), { headers });
  } catch {
    return new Response('Image processing failed', { status: 503 });
  }
}

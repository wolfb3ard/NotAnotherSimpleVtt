import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { handoutImage } from '@/lib/handout-image';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
  const missing = () => new Response(null, { status: 404, headers });
  if (!z.uuid().safeParse(id).success) return missing();
  const db = await supabaseServer();
  const { data } = await db
    .from('journal_entries')
    .select('image')
    .eq('id', id)
    .eq('kind', 'handout')
    .maybeSingle();
  if (!data?.image?.startsWith('\\x')) return missing();
  try {
    // Direct database writers can bypass upload normalization. Only serve decoded pixels.
    const safe = await handoutImage(Buffer.from(data.image.slice(2), 'hex'));
    return new Response(new Uint8Array(safe), {
      headers: { ...headers, 'Content-Type': 'image/webp' },
    });
  } catch {
    return missing();
  }
}

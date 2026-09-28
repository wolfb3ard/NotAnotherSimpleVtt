import { getSnapshot } from '@/lib/snapshot';
import { z } from 'zod';
import { configured } from '@/lib/supabase/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return Response.json({ error: 'Invalid game.' }, { status: 400 });
  if (!configured())
    return Response.json({ error: 'Database is not configured.' }, { status: 503 });
  try {
    return Response.json(await getSnapshot(id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const denied =
      error instanceof Error && ['Login required', 'Game access denied'].includes(error.message);
    return Response.json(
      { error: denied ? 'Room access ended. Return to your games.' : 'Unable to sync. Retrying…' },
      { status: denied ? 403 : 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

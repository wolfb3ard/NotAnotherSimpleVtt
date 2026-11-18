import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { configured, supabaseServer } from '@/lib/supabase/server';
import { getSnapshot } from '@/lib/snapshot';
import { Room } from '@/components/room';

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  if (!configured()) redirect('/login');
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');
  const snapshot = await getSnapshot(id).catch(() => null);
  if (!snapshot) notFound();
  return <Room initial={snapshot} />;
}

'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { handoutImage, maxHandoutBytes } from '@/lib/handout-image';

export async function writeJournal(game: string, form: FormData) {
  if (!z.uuid().safeParse(game).success) return { error: 'Invalid game.' };
  const db = await supabaseServer();
  const { data: gm } = await db.rpc('is_gm', { g: game });
  if (!gm) return { error: 'Game Master access required.' };
  const id = form.get('entry');
  const entries = db.from('journal_entries');
  let error;
  if (id !== null) {
    if (!z.uuid().safeParse(id).success) return { error: 'Invalid entry.' };
    const audience = form.get('audience');
    const text = parseText(form);
    if (audience === null && !text.success) return { error: 'Check the title and text.' };
    if (
      audience !== null &&
      audience !== 'private' &&
      audience !== 'party' &&
      !z.uuid().safeParse(audience).success
    )
      return { error: 'Choose an audience.' };
    const changes =
      audience === null
        ? text.data!
        : {
            party: audience === 'party',
            recipient_id: audience === 'private' || audience === 'party' ? null : audience,
          };
    ({ error } = await entries
      .update(changes)
      .eq('game_id', game)
      .eq('id', id)
      .select('id')
      .single());
  } else {
    const text = parseText(form);
    const kind = z
      .enum(['note', 'handout', 'recap', 'clue', 'objective'])
      .safeParse(form.get('kind'));
    const context = String(form.get('context') ?? '').split('/');
    if (
      !text.success ||
      !kind.success ||
      context.length > 2 ||
      context.some((x) => x && !z.uuid().safeParse(x).success)
    )
      return { error: 'Check the entry and its context.' };
    const file = form.get('image');
    let image = null;
    if (file instanceof File && file.size) {
      if (kind.data !== 'handout' || file.size > maxHandoutBytes)
        return { error: 'Only handouts accept images, up to 512 KiB.' };
      try {
        image = '\\x' + (await handoutImage(Buffer.from(await file.arrayBuffer()))).toString('hex');
      } catch {
        return { error: 'Choose a smaller, valid PNG, JPEG or WebP image.' };
      }
    }
    ({ error } = await entries.insert({
      game_id: game,
      ...text.data,
      kind: kind.data,
      scene_id: context[0] || null,
      encounter_id: context[1] || null,
      image,
    }));
  }
  if (error) return { error: 'Entry not saved. Check the context and audience and try again.' };
  revalidatePath(`/games/${game}/journal`);
  return { success: id ? 'Entry updated.' : 'Private entry saved.' };
}

function parseText(form: FormData) {
  return z
    .object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(8000) })
    .safeParse({ title: form.get('title'), body: form.get('body') });
}

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { ActionForm } from '@/components/action-form';
import { supabaseServer } from '@/lib/supabase/server';
import { writeJournal } from './actions';

export default async function Journal({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ entry?: string; q?: string; page?: string }>;
}) {
  const { id } = await params;
  const { entry, q, page } = await searchParams;
  if (
    !z.uuid().safeParse(id).success ||
    (entry !== undefined && !z.uuid().safeParse(entry).success)
  )
    notFound();
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');
  const { data: game } = await db.from('games').select('gm_id,name').eq('id', id).maybeSingle();
  if (!game) notFound();
  const gm = user.id === game.gm_id;
  const path = `/games/${id}/journal`;
  const action = writeJournal.bind(null, id);
  const query = typeof q === 'string' ? q.trim().slice(0, 120) : '';
  const n = Math.min(100000, Math.max(1, Number.parseInt(page ?? '1', 10) || 1));
  let rows = db
    .from('journal_entries')
    .select('id,title,body,kind,party,recipient_id,scene_id,encounter_id,has_image,created_at')
    .eq('game_id', id);
  if (entry) rows = rows.eq('id', entry);
  else if (query) rows = rows.ilike('search_text', `%${query.replace(/[\\%_]/g, '\\$&')}%`);
  const [{ data: entries, error }, scenes, encounters, members] = await Promise.all([
    rows
      .order('created_at', { ascending: false })
      .order('id')
      .range(entry ? 0 : (n - 1) * 25, entry ? 0 : n * 25),
    db.from('scenes').select('id,name').eq('game_id', id).order('name'),
    gm
      ? db
          .from('encounters')
          .select('id,scene_id,status,created_at')
          .eq('game_id', id)
          .order('created_at', { ascending: false })
      : null,
    gm
      ? db
          .from('memberships')
          .select('user_id,display_name')
          .eq('game_id', id)
          .eq('role', 'player')
          .order('display_name')
      : null,
  ]);
  if (error || scenes.error || encounters?.error || members?.error)
    throw new Error('Could not load journal.');
  if (entry && !entries?.length) notFound();
  const sceneName = (scene: string) => scenes.data?.find((s) => s.id === scene)?.name;
  const encounterName = (enc: { status: string; created_at: string }) =>
    `${enc.status} encounter · ${new Date(enc.created_at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const displayed = (entries ?? []).slice(0, 25);
  const encounterLabels = new Map(encounters?.data?.map((e) => [e.id, encounterName(e)]));
  return (
    <main className="journal-page stack">
      <Link href={`/games/${id}`}>← Back to {game.name}</Link>
      <h1>Session journal</h1>
      {gm && !entry && (
        <details className="panel">
          <summary>New private entry</summary>
          <ActionForm action={action} label="Save private entry">
            <label>
              Type
              <select name="kind">
                <option value="note">GM note (always private)</option>
                <option value="handout">Handout</option>
                <option value="recap">Session recap</option>
                <option value="clue">Clue</option>
                <option value="objective">Objective</option>
              </select>
            </label>
            <TextFields />
            <label>
              Linked context
              <select name="context">
                <option value="">Whole game</option>
                {scenes.data?.map((s) => (
                  <optgroup key={s.id} label={s.name}>
                    <option value={s.id}>{s.name}</option>
                    {encounters?.data
                      ?.filter((e) => e.scene_id === s.id)
                      .map((e) => (
                        <option key={e.id} value={`${s.id}/${e.id}`}>
                          {encounterName(e)}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              Handout image (optional, up to 512 KiB)
              <input type="file" name="image" accept="image/jpeg,image/png,image/webp" />
            </label>
          </ActionForm>
        </details>
      )}
      {entry ? (
        <Link href={path}>View all entries</Link>
      ) : (
        <form action={path}>
          <label>
            Search journal
            <input type="search" name="q" maxLength={120} defaultValue={query} />
          </label>
          <button>Search</button>
        </form>
      )}
      {(gm ? [false, true] : [true]).map((shared) => {
        const section = displayed.filter((e) => Boolean(e.party || e.recipient_id) === shared);
        if (entry && !section.length) return null;
        return (
          <section className="stack" key={String(shared)}>
            <h2>{shared ? 'Shared entries' : 'GM-private entries'}</h2>
            {!section.length && (
              <p>
                {query
                  ? 'No matching entries on this page.'
                  : shared
                    ? 'Nothing shared here yet.'
                    : 'No private entries on this page.'}
              </p>
            )}
            {section.map((e) => (
              <article className="panel stack" key={e.id}>
                <small>
                  {e.kind} · {e.created_at.slice(0, 10)} ·{' '}
                  {e.party
                    ? 'Entire party'
                    : e.recipient_id
                      ? `Shared with ${members?.data?.find((m) => m.user_id === e.recipient_id)?.display_name ?? 'you'}`
                      : 'GM only'}
                </small>
                <h3>
                  <a href={`${path}?entry=${e.id}`}>{e.title}</a>
                </h3>
                {e.scene_id && (
                  <small>
                    {sceneName(e.scene_id) ?? 'Linked scene'}
                    {e.encounter_id &&
                      ` · ${encounterLabels.get(e.encounter_id) ?? 'Linked encounter'}`}
                  </small>
                )}
                <p className="journal-text">{e.body}</p>
                {e.has_image && (
                  <a target="_blank" rel="noreferrer" href={`/api/handouts/${e.id}`}>
                    Open handout image ↗
                  </a>
                )}
                {gm && (
                  <details>
                    <summary>Edit entry</summary>
                    <ActionForm action={action} label="Save changes">
                      <input type="hidden" name="entry" value={e.id} />
                      <TextFields title={e.title} body={e.body} />
                    </ActionForm>
                  </details>
                )}
                {gm && e.kind !== 'note' && (
                  <ActionForm action={action} label="Apply audience">
                    <input type="hidden" name="entry" value={e.id} />
                    <label>
                      Publish or revoke
                      <select
                        name="audience"
                        defaultValue={e.party ? 'party' : (e.recipient_id ?? 'private')}
                      >
                        <option value="private">GM only — revoke access</option>
                        <option value="party">Publish to entire party</option>
                        {members?.data?.map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            Publish to {m.display_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </ActionForm>
                )}
              </article>
            ))}
          </section>
        );
      })}
      {!entry && (
        <nav>
          {n > 1 && (
            <Link href={`${path}?q=${encodeURIComponent(query)}&page=${n - 1}`}>
              Previous entries
            </Link>
          )}{' '}
          {entries && entries.length > 25 && (
            <Link href={`${path}?q=${encodeURIComponent(query)}&page=${n + 1}`}>Next entries</Link>
          )}
        </nav>
      )}
    </main>
  );
}

function TextFields({ title = '', body = '' }: { title?: string; body?: string }) {
  return (
    <>
      <label>
        Title
        <input name="title" required maxLength={120} defaultValue={title} />
      </label>
      <label>
        Text
        <textarea name="body" rows={5} required maxLength={8000} defaultValue={body} />
      </label>
    </>
  );
}

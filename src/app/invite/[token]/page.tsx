import { redirect } from 'next/navigation';
import Link from 'next/link';
import { configured, supabaseServer } from '@/lib/supabase/server';
import { acceptInvite } from '@/app/actions';
import { ActionForm } from '@/components/action-form';

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token))
    return (
      <main className="setup">
        <h1>Invalid invitation</h1>
        <Link href="/">Back to games</Link>
      </main>
    );
  if (!configured()) redirect('/login');
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  return (
    <main className="setup">
      <Link className="brand" href="/">
        ◈ GATHER
      </Link>
      <h1>A seat awaits you.</h1>
      <section className="card">
        <h2>Join your party</h2>
        <ActionForm action={acceptInvite} label="Accept invitation →">
          <input type="hidden" name="token" value={token} />
          <label>
            Your display name
            <input
              name="display_name"
              required
              maxLength={80}
              placeholder="Your name at the table"
            />
          </label>
        </ActionForm>
      </section>
    </main>
  );
}

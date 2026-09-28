import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { login } from '../actions';
import { configured } from '@/lib/supabase/server';

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="auth-shell">
      <section className="auth-art">
        <Link href="/" className="brand">
          ◈ GATHER
        </Link>
        <div>
          <span className="eyebrow">A PLACE FOR YOUR PARTY</span>
          <h1>
            Every great story
            <br />
            starts at a table.
          </h1>
          <p>
            Your worlds. Your characters. Your rules.
            <br />A little space for an extraordinary adventure.
          </p>
        </div>
        <span className="subtle">SYSTEM-AGNOSTIC · BUILT FOR SHARED STORIES</span>
      </section>
      <section className="auth-form">
        <span className="eyebrow">WELCOME TO THE TABLE</span>
        <h2>Your next adventure awaits.</h2>
        <p className="muted">Sign in with a link sent straight to your inbox.</p>
        {!configured() ? (
          <div className="notice">
            Connect Supabase to enable sign-in. Follow the setup steps in README.md and add your
            credentials to .env.local.
          </div>
        ) : (
          <ActionForm action={login} label="Send sign-in link">
            <label>
              Email address
              <input
                name="email"
                type="email"
                placeholder="adventurer@example.com"
                required
                autoComplete="email"
              />
            </label>
            <input type="hidden" name="next" value={params.next || '/'} />
          </ActionForm>
        )}
        {params.error && (
          <p className="notice">That link expired or was already used. Request a new one.</p>
        )}
        <p className="small muted">
          No passwords to remember. Open the email link in this browser.
        </p>
      </section>
    </main>
  );
}

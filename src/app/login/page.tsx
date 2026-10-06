import Link from 'next/link';
import { LoginForm } from '@/components/login-form';
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
          ◈ Not Another Simple Vtt
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
        <p className="muted">Sign in with your Google account.</p>
        {!configured() ? (
          <div className="notice">
            Connect Supabase to enable sign-in. Follow the setup steps in README.md and add your
            credentials to .env.local.
          </div>
        ) : (
          <LoginForm next={params.next || '/'} />
        )}
        {params.error && (
          <p className="notice" role="alert">
            {params.error === 'oauth'
              ? 'Sign-in was cancelled or rejected. Please try again.'
              : 'Unable to finish sign-in. Please try again in the same browser where you started.'}
          </p>
        )}
        <p className="small muted">
          No email links or new passwords. Continue in this browser to finish signing in.
        </p>
      </section>
    </main>
  );
}

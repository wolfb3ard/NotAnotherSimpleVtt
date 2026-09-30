'use client';

import { useActionState } from 'react';
import { login } from '@/app/actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="stack" aria-busy={pending}>
      <input type="hidden" name="next" value={next} />
      <button className="primary" type="submit" name="provider" value="google" disabled={pending}>
        Continue with Google
      </button>
      <button type="submit" name="provider" value="discord" disabled={pending}>
        Continue with Discord
      </button>
      {pending && (
        <p className="muted" role="status">
          Connecting…
        </p>
      )}
      {state.error && (
        <p className="notice" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

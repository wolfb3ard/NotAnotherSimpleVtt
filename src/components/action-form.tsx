'use client';
import { useState } from 'react';

export function ActionForm({
  action,
  children,
  label,
}: {
  action: (form: FormData) => Promise<{ error?: string; success?: string }>;
  children: React.ReactNode;
  label: string;
}) {
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setStatus('');
        try {
          const result = await action(new FormData(event.currentTarget));
          setStatus(result.error || result.success || 'Done.');
        } catch {
          setStatus('Unable to connect. Please try again.');
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      <button className="primary" disabled={pending}>
        {pending ? 'Working…' : label}
      </button>
      {status && (
        <p className="notice" role="status">
          {status}
        </p>
      )}
    </form>
  );
}

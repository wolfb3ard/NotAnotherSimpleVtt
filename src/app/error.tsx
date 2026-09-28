'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="setup">
      <h1>Connection interrupted.</h1>
      <p>Your saved game is still at the table. Try again in a moment.</p>
      <button className="primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}

import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="setup">
      <h1>This path ends here.</h1>
      <p className="muted">The room doesn’t exist, or you don’t have access.</p>
      <Link className="button primary" href="/">
        Back to your games
      </Link>
    </main>
  );
}

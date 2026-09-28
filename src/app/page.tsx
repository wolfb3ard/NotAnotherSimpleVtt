import Link from 'next/link';
import { redirect } from 'next/navigation';
import { configured, supabaseServer } from '@/lib/supabase/server';
import { createGame, logout } from './actions';
import { ActionForm } from '@/components/action-form';

export default async function Home() {
  if (!configured())
    return (
      <main className="setup">
        <div className="brand">◈ GATHER</div>
        <span className="eyebrow">NOT ANOTHER SIMPLE VTT</span>
        <h1>
          Your world.
          <br />
          One shared table.
        </h1>
        <p className="muted">
          A system-agnostic home for your next adventure.
          <br />
          Maps, characters, fog of war, and a little luck.
        </p>
        <section className="card">
          <h2>Set your table</h2>
          <p>
            Add Supabase credentials to <code>.env.local</code>, then apply the database migrations.
          </p>
          <p className="muted">
            Full setup instructions are in <code>README.md</code>.
          </p>
          <Link className="button primary" href="/login">
            Go to sign in →
          </Link>
        </section>
      </main>
    );
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');
  const { data: games, error } = await db
    .from('games')
    .select('*')
    .order('created_at', { ascending: false });
  return (
    <main className="dashboard">
      <header className="topbar">
        <Link className="brand" href="/">
          ◈ GATHER
        </Link>
        <form action={logout}>
          <button className="ghost">Sign out</button>
        </form>
      </header>
      <div className="dashboard-title">
        <span className="eyebrow">YOUR ADVENTURES</span>
        <h1>Welcome to the table.</h1>
        <p className="muted">Pick up where your party left off, or start something new.</p>
      </div>
      <div className="dashboard-grid">
        <section>
          <h2>
            Your games <span className="badge">{games?.length ?? 0}</span>
          </h2>
          {error && (
            <p className="notice">Unable to load games. Check your database configuration.</p>
          )}
          <div className="game-grid">
            {games?.map((game) => (
              <Link className="game-card" key={game.id} href={`/games/${game.id}`}>
                <span className="game-art">◈</span>
                <span className="eyebrow">{game.gm_id === user.id ? 'GAME MASTER' : 'PLAYER'}</span>
                <h3>{game.name}</h3>
                <span className="muted">
                  Return to adventure <span className="arrow">↗</span>
                </span>
              </Link>
            ))}
          </div>
          {games?.length === 0 && (
            <div className="empty">
              <span>◇</span>
              <h3>A fresh page in your story.</h3>
              <p>Create a game, or open an invitation from your GM.</p>
            </div>
          )}
        </section>
        <aside className="card">
          <span className="eyebrow">A NEW CHAPTER</span>
          <h2>Create a game</h2>
          <p className="muted">You’ll be the GM. Invite your party once your room is ready.</p>
          <ActionForm action={createGame} label="Create game →">
            <label>
              Game name
              <input name="name" placeholder="The lost coast" required maxLength={100} />
            </label>
            <label>
              Your display name
              <input
                name="display_name"
                placeholder="What should your party call you?"
                required
                maxLength={80}
              />
            </label>
          </ActionForm>
        </aside>
      </div>
    </main>
  );
}

# NotAnotherSimpleVtt

**Gather** is a desktop-browser, system-agnostic virtual tabletop. Next.js runs on Vercel; Supabase provides authentication, Postgres, private image storage, and realtime room updates.

## Included

- Magic-link sign-in, multiple games, game-scoped GM/player roles, and expiring/revocable invitations.
- Custom character/NPC/enemy sheets, sections, text/numeric/resource fields, abilities, sheet permissions, and reusable templates.
- Multiple saved scenes, uploaded maps/tokens, pan/zoom, assigned token control, live movement checkpoints, scene calibration, and a straight-line ruler.
- Manual reveal/conceal fog, GM-hidden tokens, and player-view previews. Concealed background pixels are removed server-side.
- Server-generated dice rolls: custom die sizes, mixed dice, arithmetic, parentheses, keep-highest/lowest, modifiers, and saved rolls using sheet fields.
- Animated 3D polyhedral dice over the tabletop (d4/d6/d8/d10/d12/d20), anonymous private-player roll cues, and per-user dice material customization.
- Public/private roll history, optimistic revision checks, reconnect reconciliation, and database-enforced access controls.

See [PLAN.md](PLAN.md) for the agreed scope and [docs/STATUS.md](docs/STATUS.md) for verification and remaining launch work.

## Requirements

- Node.js 22.12+ (Node 22 LTS recommended), npm, and a Supabase project.
- Docker Desktop and the Supabase CLI if running Supabase locally.
- Desktop browser. Mobile tabletop controls are not part of this release.

## Local setup

```sh
npm ci
```

Copy `.env.example` to `.env.local`, then set:

| Variable                               | Value                                                     |
| -------------------------------------- | --------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (legacy anon keys also work)              |
| `SUPABASE_SERVICE_ROLE_KEY`            | Server-only service-role key for dice and private storage |
| `NEXT_PUBLIC_SITE_URL`                 | `http://localhost:3000`                                   |

### Option A: local Supabase

Start Docker Desktop, then:

```sh
npx supabase start
npx supabase status
```

Use the local URL, anon key, and service-role key in `.env.local`. Migrations are applied when the local project is created. After changing migrations, `npx supabase db reset` recreates the **local** database and deletes its existing data.

Local email links appear in the mail inbox at `http://localhost:54324`. Open links in the same browser used to request them.

### Option B: hosted Supabase

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Use an empty project or review migrations before applying them to an existing database. In Supabase Authentication → URL Configuration, set the site URL and allow `http://localhost:3000/auth/callback`. Enable email sign-in. Configure SMTP before inviting real players; Supabase's default email sender has restricted delivery and quotas.

### Run

```sh
npm run dev
```

Open `http://localhost:3000`. Without environment configuration, the app displays setup instructions. No game data is fabricated.

## First session

1. Sign in and create a game. Its creator becomes the GM.
2. Open **Room → Create invitation link** and share it with players.
3. Open **Scenes**, upload a background, then reveal an area or the entire map. New scenes start concealed.
4. Use **Calibrate**, draw a known distance, enter its length and unit, then set the scale.
5. In **Party**, create actors and add sections, fields, or abilities. Save changes explicitly.
6. Add actor tokens to the active scene. Upload an optional image; otherwise initials are used. Tokens start near `(100, 100)`; reveal that area or move them as GM.
7. Select a token as GM to change its controller, size, or visibility. Players drag only their assigned visible tokens into revealed areas.
8. Use **Dice** for manual rolls. Add a numeric sheet field or prepare a saved ability roll from a sheet.

Examples: `2d6 + 3`, `(1d8 + 2) * 2`, `4d6kh3`, `2d20kl1`. Advantage/disadvantage shortcuts require d20 to be enabled. Sheet references use stable `@{field-uuid}` identifiers inserted by the editor.

Private player rolls are visible to that player and the GM. Private GM rolls are GM-only. Players can supply arbitrary manual modifiers; sheet references require authorized character access and control.

Standard dice tumble to their authoritative server-generated result. A d10 has faces 0–9, with 0 representing a result of 10. Arbitrary die sizes use a `?`-faced d6 visual; authorized text history still shows their real die size and outcome. Everyone sees an anonymous `?`-faced d6 when a **player** rolls privately, without identity, die count, expression, or result. Private GM rolls never appear to players. Use **Style** in the room to edit and save your own dice colors, opacity, glossiness, and shimmer. Animations are visual only and never determine results; WebGL and reduced-motion fallbacks remain readable.

## Checks

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Tests cover dice arithmetic and limits, fog pixel masking, geometry, sheet validation, movement ordering, and real Postgres RLS/RPC behavior using PGlite. PGlite tests supply Supabase's auth/storage schema scaffolding; they do not emulate Supabase Auth, Storage HTTP, or Realtime.

Browser smoke tests run without infrastructure. The full nine-browser multiplayer test requires an isolated Supabase project and explicit opt-in:

```powershell
# Load the three Supabase variables above into this shell, using the same test
# project as .env.local. The test runner does not load .env.local automatically.
$env:E2E_SUPABASE = '1'
npm run test:e2e
```

This suite creates temporary auth users, a game, an image, and gameplay data, then removes them. Do not point it at production. If Chromium download is unavailable, use installed Chrome with `$env:PLAYWRIGHT_CHANNEL = 'chrome'` (or `msedge`).

## Deployment

1. Configure the GitHub `production` environment for automated Supabase migrations (below). Review the project's existing migration history before the first deployment.
2. Import the GitHub repository into Vercel using its Next.js preset and Node 22.
3. Add the four environment variables above; use the production origin for `NEXT_PUBLIC_SITE_URL`.
4. Add the production `/auth/callback` URL to Supabase's allowed redirects and configure email delivery.
5. Deploy and complete the live smoke test in [docs/OPERATIONS.md](docs/OPERATIONS.md).

Keep development/preview projects separate from production. Preview deployments need their own site URL and allowed authentication callback URL. Public Supabase variables are embedded at build time, so rebuild after changing them.

### Automatic production database migrations

`.github/workflows/deploy-supabase.yml` runs **only after a successful `Checks` workflow for a push to `main`**. It checks out the exact validated commit, links the production Supabase project, prints the pending migrations with `db push --dry-run`, and applies them with `db push`. Pull requests never deploy; subsequent runs are safe when there are no pending migrations. Deployments are serialized and never cancel one another. The `production` GitHub environment can require a reviewer before database access.

Before merging the workflow, open **GitHub → Settings → Environments** and create `production`. Add these **environment-level** values (not `.env`, code, or Vercel variables):

| Name                    | Kind     | Source                                                              |
| ----------------------- | -------- | ------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Secret   | Supabase account access token with access to the production project |
| `SUPABASE_DB_PASSWORD`  | Secret   | Production project Postgres password                                |
| `SUPABASE_PROJECT_REF`  | Variable | 20-character project ref from the Supabase dashboard URL            |

Restrict the environment to `main` and enable required reviewers if you want a human approval gate. The job fails with a configuration message when values are missing; it **does not** fall back to a local or preview project. Do not point the opt-in multiplayer test at production.

This action deploys **versioned database migrations**, including their SQL-defined RLS policies, functions, and bucket setup. It does not configure hosted Auth URLs/SMTP, provision Supabase projects, deploy Edge Functions, or manage Vercel environment variables. Vercel's GitHub integration may deploy in parallel with this workflow; until production deployment is explicitly gated on migration completion, write backward-compatible migrations and avoid releasing application code that requires a new schema before it is applied. Back up the production database and review migrations before merge.

## Structure

```text
src/app/                 Pages, server actions, auth and authorized image/data routes
src/components/          Room UI, Konva tabletop, and sheet editor
src/lib/                 Dice, schemas, masking, movement, Supabase clients, tests
supabase/migrations/     Tables, RLS, mutation RPCs, room invalidation, validation
e2e/                    Browser smoke and opt-in multiplayer tests
docs/                   Architecture, operating limits, and release status
```

## Initial limits

- Static PNG/JPEG/WebP uploads: 4 MB and 4096 × 4096 pixels maximum (leaves room for multipart overhead under Vercel's function request limit).
- 500 ordered fog rectangles per scene; reveal/conceal-all resets the list.
- 100 dice per roll, 2–1,000,000 sides, 30 configured die types, 500-character expressions, 32 nesting levels, and results bounded to ±10¹².
- Up to 20 sheet sections, each with 40 fields and 30 abilities.
- UI shows the latest 50 authorized rolls; older history remains in Postgres.
- Target: one GM plus eight players. Hosted load testing remains a launch check.
- Grid snapping, mobile controls, automatic vision, dynamic lighting, and ruleset-specific automation are deferred.

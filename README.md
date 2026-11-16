# Not Another Simple Vtt

**Not Another Simple Vtt** is a desktop-browser, system-agnostic virtual tabletop. Next.js runs on Vercel; Supabase provides authentication, Postgres, private image storage, and realtime room updates.

## Included

- Google sign-in through Supabase, multiple games, game-scoped GM/player roles, and expiring/revocable invitations.
- Custom character/NPC/enemy sheets, sections, text/numeric/resource fields, abilities, sheet permissions, and reusable templates.
- Multiple saved scenes, uploaded maps/tokens, pan/zoom, assigned token control, reversible committed moves/fog edits, scene calibration, and a straight-line ruler.
- Manual reveal/conceal fog, GM-hidden tokens, and player-view previews. Concealed background pixels are removed server-side.
- Server-generated dice rolls: custom die sizes, mixed dice, arithmetic, parentheses, keep-highest/lowest, modifiers, and saved rolls using sheet fields.
- Animated 3D polyhedral dice over the tabletop (d4/d6/d8/d10/d12/d20), anonymous private-player roll cues, and per-user dice material customization.
- Public/private roll history, optimistic revision checks, reconnect reconciliation, and database-enforced access controls.

## Physical dice & 5.5e sheets

- Dice use fixed-step rigid-body physics: gravity, angular momentum, friction, bouncing, tray walls, and dice-to-dice collisions. Labels remain fixed throughout the throw; d4s use repeated vertex numbers and d10s print 10. Full-screen, click-through rendering and personal 100%–200% zoom are preserved.
- Results remain cryptographically random and server-authoritative. Before playback, the client simulates a throw and applies a **constant rotational symmetry** to each die's complete trajectory to match the recorded result. This preserves the physical shape and conventional face layout without steering or changing numbers mid-flight. Motion can hint at the eventual face; it cannot predict future random rolls.
- Up to eight dice are animated. Other die sizes show question marks; overflow stays in history. Reduced-motion/WebGL fallback retains the recorded result. Cocked throws are retried before playback, with a static result fallback if simulation fails.
- Create a character → **Start from template → 5.5e · SRD 5.2.1**. Save edits, then prepare checks, saves, skills, weapon/spell attacks, damage, critical damage, or initiative directly from the sheet. D20 rolls offer advantage/disadvantage; the existing roll panel confirms visibility and situational modifiers.
- Level (1–20), ability scores (1–30), selected proficiencies/expertise, bonuses, and exhaustion drive calculations. Derived modifiers are recalculated server-side from the saved sheet. Damage adds the configured ability and bonuses, never proficiency; criticals double dice, not modifiers. `max(0, expression)` prevents negative damage.
- New characters using the built-in 5.5e template open guided creation automatically. Existing manual sheets offer **Create with SRD builder** for origins, ability generation, class skills, feats, spells, and progression. **Progress / level up character** adds class or multiclass levels through 20. Apply the draft, then **Save sheet**; Cancel/Escape discards the draft. Blank/manual sheets remain supported, and an attached builder can be detached for manual/homebrew changes.
- This is not a complete encounter/condition simulator. Review the catalog's **Automation limitations** and source rules for conditional effects, item variants, and tactical actions. Features, tool checks, additional damage dice, situational effects, and further attacks can use custom fields/abilities and roll expressions. Advantage and disadvantage together cancel; choose a normal roll.
- Built-in sheets retain the version-1 document format, permissions, revision checks, and reusable/cross-game templates. Structured character tabs use an optional character-data extension; apply the migration below.

### SRD attribution

This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

The rules have been adapted into an interactive sheet and calculations. Source: the supplied `SRD_CC_v5.2.1.pdf`, especially pp. 6–9 (D20 tests/proficiency), 13 (initiative), 16 (damage/critical hits), and the Exhaustion rules glossary entry.

### SRD catalog & progression

- **SRD 5.2.1 catalog & complete source pages** provides searchable classes/subclasses, species, backgrounds, feats, class features/options, spells, mundane equipment, and magic items. Original text from all 364 PDF pages remains accessible; long sheet entries link back to the full catalog text.
- The imported player catalog includes the SRD's 12 classes and their 12 subclasses, 9 species, 4 backgrounds, 17 feats, and 338 spells. This is the SRD subset, not every option from the commercial Player's Handbook. Heading counts are regression checks, not an independent completeness audit.
- Creation supports standard array, point buy, or recorded 4d6-drop-lowest results; background boosts/feats; species/lineage choices; class skills, expertise, weapon mastery, spells, and feature options. Recorded ability dice are editable character-builder input, not authenticated server roll-history results.
- Progression distinguishes class and character levels, checks multiclass prerequisites, and calculates HP, grouped Hit Dice, proficiency, features, spell preparation/book choices, spell slots, and separate Pact Magic resources. Half-casters round up independently for multiclass slot progression. Manual annotations and spent resources survive level-up.
- Starting equipment expands into individual quantities, including pack contents and currency. Choose purchases, armor/shield, ready weapons, and eligible Wild Shape/familiar/Pact options inside the builder. Armor training, Strength requirements and Stealth warnings are shown; named +1–3 equipment bonuses apply automatically. Blowguns support fixed damage without inventing or doubling damage dice.
- The inventory catalog separates actual items from rules headings and includes mounts, vehicles, foci, tools, ammunition lots, barding, and all 100 character-creation trinkets. Magic-item variants carry their printed rarity rather than defaulting grouped items to Common. Adding a catalog item is an inventory award, not a purchase; it does not automatically spend money or apply all magical effects.
- **Play resources** adjusts class counters, Pact slots, and grouped Hit Dice. Expand **Class resources, grouped Hit Dice & spellcasting** to inspect their statistics or edit configuration. The Spell tab offers class/feat/species-specific attack rolls as well as the configurable default. Alert's proficiency bonus applies to initiative without increasing unrelated checks.
- Builder decisions are optional versioned sheet data, validated by both application and database. Apply `supabase/migrations/202611150004_srd_builder.sql` after earlier migrations. Old manual sheets and templates remain valid. New source data/migrations are checked in; normal application startup does not fetch an external rules API.

To reproduce the import, install Python and PyMuPDF (`python -m pip install PyMuPDF`), provide the source PDF, then run `npm run srd:import`. The source fingerprint and attribution are in `src/lib/srd-data/manifest.json`. After changing builder rules, run `npm run srd:migration` and the application/database tests. Generation never applies hosted changes; review generated migrations before merge, when the production workflow applies them.

## Character sheet windows & access

- Party cards stay compact. **Click** a card (or focus it and press **Enter/Space**) to open its sheet in a separate, non-modal window within the VTT. Tokens can also open the sheet.
- The persistent **My character** shortcut opens your owned character from any panel. If you own several characters, choose one from its dropdown. With none, **My characters** opens Party with guidance to create a character or ask the GM to assign one. Switching sheets still protects unsaved changes.
- **Roll visibility** stays visible above the tabletop and shares the Dice panel's setting, including when rolls are popped out. It applies to both sheet and manual rolls: **Everyone**, **Me and GM** for private player rolls, or **Only me** for private GM rolls. Set this before clicking a sheet roll.
- Drag the window header, use arrow keys on its focused move handle, resize from the corner, or maximize/restore. Close with × or Escape. Unsaved edits require confirmation before closing/switching; a saved sheet roll opens the existing dice panel. The window closes if a refreshed snapshot removes sheet access.
- Built-in 5.5e sheets keep combat and HP visible alongside six keyboard-accessible tabs. “Customize sheet” retains the generic section/field/ability editor.
- GMs use **Manage sheet access → Sheet owner / member access** to assign ownership, no access, view-only, or view-and-edit grants. The owner can edit and roll; the GM always has full access. No-access sheets/cards are filtered by database row-level security, not merely hidden in the UI.
- Ownership transfers require a current revision and a member of the same game. Former-owner grants are cleared and tokens they controlled for that character transfer to the new owner. Other assigned token controllers are unchanged. Regrant view/edit access explicitly if needed.
- Apply `supabase/migrations/202611150001_actor_ownership.sql` before using ownership transfers. The transfer RPC enforces GM authorization even when called directly; existing view/edit grants retain their database authorization boundary.

### Character tabs

- **Actions:** weapon/spell attack rolls, cantrips, prepared spells, features grouped by Action, Bonus action, Reaction, Other or Passive, and custom abilities. Feature uses are shared with Features & Traits.
- **Spell:** add/remove spells, select level and casting time, prepare/unprepare spells, and use/recover spell slots. Lists run from cantrips through level 9, alphabetically within each level. Builder progression sets slot maxima; manual sheets can configure them directly. Casting does not automatically spend a slot.
- **Inventory:** add/remove items, quantity, descriptions, rarity and attunement (normally three items; four for an attached Thief builder at Rogue level 13). Rarities are labelled and colour-coded: common grey/white, uncommon green, rare blue, very rare purple, legendary orange, artifact pink.
- **Features & Traits:** class, species, background, feat or other features, descriptions, action types and limited-use counters. Zero maximum uses means unlimited/passive; configure a maximum, then recover uses as needed.
- **Biography:** chosen background, physical description, personality/mental description, family history and notes.
- Existing free-text spell, equipment and feature notes stay in their matching tabs. Configuration changes require **Save sheet** and are included in reusable templates; current resource/feature-use updates save immediately. View-only access remains read-only.
- Apply `supabase/migrations/202611150002_character_tabs.sql` before deployment. This validates the optional character extension at the database boundary; older sheets remain valid. Application startup never migrates databases; the production workflow below applies pending migrations.

### Play resources and quick health updates

- **Play resources** saves current HP, temporary HP, resource counters, spell/Pact slots, grouped Hit Dice, and limited feature uses immediately. Generic resource fields work too. Existing **Use/Recover** feature and spell-slot buttons also save immediately. Token control alone does not grant resource editing.
- **Resources: Saving… / Saved / Failed** describes confirmation, not just local edits. Rapid current-value edits queue in order. Failures restore the last confirmed display and retain **Retry resource update** with the same operation ID, preventing duplicate application after a lost response.
- **Reload resources** fetches a fresh authorized snapshot and discards unconfirmed queued intent; an offline reload stays Failed. After a concurrent edit, reload/review values rather than replaying stale intent. Ordinary refresh/reconnect synchronizes clean sheets; configuration drafts retain their conflict warning. Pending/failed updates participate in the existing close/switch warning.
- **Damage / Heal** previews HP and temporary HP, then requires confirmation. Damage normally consumes temporary HP first; turn that off to override. Healing stops at maximum HP and does not change temporary HP. Direct resource inputs remain manual overrides. Resistance, vulnerability, concentration, death saves, and other conditional rules are not automated. Temporary HP is an optional resource added to old D&D sheets only when used; entering it replaces the current value, not stacks it.
- Names, field definitions/maxima, generic numeric stats, exhaustion, inventory, biography, spell preparation, feature configuration, and builder decisions remain explicit drafts: **Apply** in the builder, then **Save sheet**. Save/reload dirty configuration before using quick updates. Configuration controls lock while a resource write is pending/unconfirmed; draft controls also lock during whole-sheet saves.
- Apply `supabase/migrations/20261116152232_quick_actor_resources.sql` after earlier migrations before deploying. Its RPC authorizes current GM/owner/edit grants, serializes with room permission changes, revision-checks atomic multi-resource updates, and privately stores per-user operation receipts. Existing sheets/templates remain valid. Application startup never migrates databases; the production workflow below applies pending migrations.

## Persistent token appearance

- Open any sheet → **Token appearance**. Owners and GMs can upload a PNG/JPEG/WebP portrait (up to 4 MB), choose one of six ring presets, and **Save appearance**. Portraits are center-cropped, not stretched. This save is separate from sheet-stat edits.
- **Add token to scene** places the saved appearance in the active scene. Players can place their own actors; GMs can place any actor, including multiple instances of a monster. Player placement retries do not create duplicates.
- Appearance changes update existing placements in every scene. Tokens link to the same live sheet: HP, resources, and other stats are not copied or reset on placement or scene changes. Multiple instances of the same monster sheet share stats; create separate sheets for independent monsters.
- Placement starts near the map’s top-left. Existing fog/hidden-token rules still apply; a GM may need to reveal that area. Party placement remains a shortcut, but appearance is managed on the sheet.

### Undo tabletop edits

- **Undo: Move token / Edit fog** in the map toolbar, or **Ctrl/Cmd+Z** outside text inputs, reverses your latest eligible action in the active scene. A drag commits once on drop. Painted fog and Reveal/Conceal entire scene are supported.
- The server retains your last **20 actions per game for 24 hours**, including undone receipts for safe retries. History survives refresh and is reconciled on reconnect/focus; switching scenes shows only that scene's entries.
- Undo checks current permission, visibility and revision. A newer change blocks reversal rather than overwriting it; adjust manually. Scale, token size/visibility/control, creation, deletion and sheets are not part of this history. No redo.
- **Saving**, **confirmed**, and **failed or unconfirmed** feedback distinguishes acknowledgement from an uncertain request. **Retry tabletop change** resends the exact operation ID, never applies it twice. Unconfirmed requests survive reload in the same tab when session storage is available. **Dismiss attempt** only stops retrying and reloads history; it does not reverse a change.
- Concealing again cannot erase information a player already saw or saved.
- Apply `supabase/migrations/20261116120505_persistent_actor_tokens.sql` after earlier migrations before deploying. Existing actors inherit one deterministic existing token portrait (lowest token ID with an image); scene-specific portraits then share that character appearance. Application startup never migrates databases; the production workflow below applies pending migrations.

## Character deletion & roll windows

- **Delete character** is available inside a sheet to its owner and the game's GM only. Sheet edit grants and token control do not grant deletion rights. Confirmation and a current sheet revision are required. Deletion removes the character, all their scene tokens, and access grants; saved templates remain.
- Open **Dice → Pop out roll window** for a non-modal window within the VTT. Drag its header, move the focused handle with arrow keys, resize its corner, or maximize/restore. **Dock roll window** or Escape returns it to the Dice panel. It remains usable while another sidebar panel or character sheet is open; expression, character, purpose, modifiers, and visibility are shared rather than copied.
- Sheet rolls record their purpose automatically (for example, **Attack roll with Longsword**, **Strength save**, or **Athletics check**). Manual rolls have an editable **Roll type**. History shows the character's recorded name, the purpose, and the player who rolled; renaming or deleting a character does not rewrite earlier attribution.
- Apply `supabase/migrations/202611150003_character_deletion_roll_context.sql` before deployment. Existing rolls receive their character's name at migration time; their previously unrecorded purpose is labelled **Unspecified roll**. Public/private roll access and anonymous private-roll cues are unchanged. Application startup never migrates databases; the production workflow below applies pending migrations.

See [PLAN.md](PLAN.md) for the agreed scope and [docs/STATUS.md](docs/STATUS.md) for verification and remaining launch work.

See [vtt_v2.md](vtt_v2.md) for the phased remote-D&D usability roadmap, epic tasks, dependencies, and review gates.

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

Local OAuth requires provider credentials in `supabase/config.toml` and the local Supabase Auth callback registered with each provider. See [federated login setup](#federated-login-setup). The local mail inbox is not used by the application's login flow.

### Option B: hosted Supabase

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Use an empty project or review migrations before applying them to an existing database. In Supabase Authentication → URL Configuration, set the site URL and allow `http://localhost:3000/auth/callback`. Enable Google using the setup below. Application login does not send email, so Supabase's email-send quota and SMTP configuration are not involved.

### Federated login setup

Supabase remains the session and identity backend; no database migrations or additional app environment variables are needed. Configure Google before inviting players. Discord's backend support remains available, but its sign-in button is currently hidden and configuring it is not required. Client secrets belong only in Supabase's provider settings (or local Supabase environment variables), never in `NEXT_PUBLIC_*` variables or source control.

There are **two different callbacks**:

- **Provider → Supabase:** `https://<project-ref>.supabase.co/auth/v1/callback`. Copy the exact callback from Supabase Authentication → Sign In / Providers. Register this URL with Google and Discord, **not** the app's `/auth/callback`.
- **Supabase → app:** `https://notanothersimplevtt.vercel.app/auth/callback`. Allow this in Supabase Authentication → URL Configuration and set the Site URL to `https://notanothersimplevtt.vercel.app`. Allow `http://localhost:3000/auth/callback` separately for local Next.js development against hosted Supabase. Use the public domain, not the protected team/deployment aliases.

**Google**

1. Create a Google Cloud project and configure Google Auth Platform branding, audience, and the basic `openid`, email, and profile scopes.
2. Create an OAuth client with type **Web application**. Add the public app origin under **Authorized JavaScript origins** (and `http://localhost:3000` for development), and the **Supabase callback** under **Authorized redirect URIs**.
3. In Supabase Authentication → Sign In / Providers → Google, enable the provider and save the client ID and secret.
4. While Google's app is in testing, add permitted test users. Set the appropriate production audience/publishing status before inviting other players.

**Discord (optional; sign-in button currently hidden)**

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **OAuth2 → Redirects**, register the **Supabase callback**.
3. In Supabase Authentication → Sign In / Providers → Discord, enable the provider and save its client ID and secret. No bot or guild permissions are needed.

For a **local Supabase** stack, copy its Auth callback (normally `http://127.0.0.1:54321/auth/v1/callback`) into separate development provider clients, and add `[auth.external.google]` / `[auth.external.discord]` entries to `supabase/config.toml` with `enabled = true`, the development `client_id`, and `secret = "env(SUPABASE_AUTH_EXTERNAL_<PROVIDER>_SECRET)"`. Supply secrets to the CLI environment and restart the stack. Hosted provider settings do not configure the local stack.

Existing games and permissions still use Supabase user IDs. For an existing email-login user, use a provider account with the same verified email; Supabase can automatically link matching verified identities. A different email may create a separate user with no existing memberships. Verify access to existing games before retiring an old login identity; do not reassign memberships merely because a user supplies an email address.

See the official [Google](https://supabase.com/docs/guides/auth/social-login/auth-google) and [Discord](https://supabase.com/docs/guides/auth/social-login/auth-discord) setup guides. For a live smoke test, sign in with Google in a signed-out browser, verify dashboard access and logout, then repeat from a valid invitation. Cancelling provider consent should offer a retry and retain the invitation.

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

Browser smoke tests run without infrastructure, including provider handoff, same-site callbacks, PKCE cookie persistence, and cancelled-login recovery. The test server uses dummy Supabase values unless supplied through the runner's environment; the OAuth handoff is intercepted, not completed with Google/Discord. The full nine-browser multiplayer test requires an isolated Supabase project and explicit opt-in:

```powershell
# Load the three Supabase variables above into this shell, using the same test
# project as .env.local. The test runner does not load .env.local automatically.
$env:E2E_SUPABASE = '1'
npm run test:e2e
```

This suite creates temporary auth users, a game, an image, and gameplay data, then removes them. Do not point it at production. If Chromium download is unavailable, use installed Chrome with `$env:PLAYWRIGHT_CHANNEL = 'chrome'` (or `msedge`).

## Deployment

1. Configure the GitHub `production` environment for the ordered production release (below), including Vercel credentials **before merging the workflow**. Review the project's existing migration history before the first deployment.
2. Import the GitHub repository into Vercel using its Next.js preset and Node 22.
3. Add the four environment variables above; use the production origin for `NEXT_PUBLIC_SITE_URL`.
4. Set Supabase's site URL to the public production origin, add its `/auth/callback` URL to the allowed redirects, and enable/configure Google as described above. Use the stable public domain, not a deployment-specific Vercel URL that requires Vercel authentication.
5. Deploy and complete the live smoke test in [docs/OPERATIONS.md](docs/OPERATIONS.md).

Keep development/preview projects separate from production. Preview deployments need their own site URL and allowed authentication callback URL. Public Supabase variables are embedded at build time, so rebuild after changing them.

OAuth callbacks and post-login redirects stay on the origin where login started so the browser can use its PKCE verifier cookie. Allow each intended origin's callback in Supabase, including local development. Supabase can fall back to its configured site URL if a requested redirect is not allowed. Test the public production domain in a signed-out/private browser; players should never need a Vercel account. Protected previews still require deployment access; this app does not bypass Vercel protection.

OAuth requests use the exact `/auth/callback` URL without query parameters. Invitation destinations are stored in a 10-minute, HttpOnly, SameSite=Lax cookie scoped to the callback; the callback validates and clears it, including on failure. This avoids Supabase rejecting `?next=...` against an exact callback allowlist and falling back to a protected Site URL. Keep Supabase's Site URL public as well; do not solve this by disabling deployment protection or broadly allowing arbitrary redirects.

Invitation links are generated on the server using the public site domain, not the GM's browser alias. Set `NEXT_PUBLIC_SITE_URL` to the public domain. On Vercel production, `VERCEL_PROJECT_PRODUCTION_URL` supplies the project domain when the site URL is missing, local, or a Vercel alias; configured custom domains take precedence. Local invitations stay local, and isolated previews should configure their own site URL. An old invite with a protected hostname can be repaired by replacing only its hostname with the public app hostname; keep its token unchanged. Vercel protection runs before the app, so the app cannot redirect visitors arriving at a protected URL around that protection.

### Ordered production releases

`.github/workflows/deploy-supabase.yml` (**Deploy production**) runs **only after a successful `Checks` workflow for a push to `main`**. It checks out that exact validated SHA and skips stale runs if `main` has advanced. The entire release is serialized without cancelling an in-flight migration. The `production` GitHub environment can require a reviewer.

Release order:

1. Verify all deployment credentials; install locked application dependencies and a pinned Vercel CLI; pull production project settings/environment. Invalid Vercel access fails before database changes.
2. Link production Supabase, show pending migrations with `db push --dry-run`, then apply them with `db push`.
3. Build that same commit with `vercel build --prod`, using the pulled production environment.
4. Deploy only the resulting artifact with `vercel deploy --prebuilt --prod`.

Missing configuration, migration failures, or build failures stop the release before application deployment. `vercel.json` disables Vercel's independent Git deployments for `main`, closing the parallel-deployment race. Other branches retain automatic previews; PR checks never enter the production workflow. No-pending-migration runs still build/deploy the application.

Before merging the workflow, open **GitHub → Settings → Environments** and create `production`. Add these **environment-level** values (not `.env`, code, or Vercel variables):

| Name                    | Kind     | Source                                                              |
| ----------------------- | -------- | ------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Secret   | Supabase account access token with access to the production project |
| `SUPABASE_DB_PASSWORD`  | Secret   | Production project Postgres password                                |
| `SUPABASE_PROJECT_REF`  | Variable | 20-character project ref from the Supabase dashboard URL            |
| `VERCEL_TOKEN`          | Secret   | Vercel deployment token scoped to the production team/project       |
| `VERCEL_ORG_ID`         | Secret   | Team ID from the linked project's `.vercel/project.json` (`orgId`)  |
| `VERCEL_PROJECT_ID`     | Secret   | Project ID from `.vercel/project.json` (`projectId`)                |

Restrict the environment to `main` and enable required reviewers if you want a human approval gate. The job fails with a configuration message when values are missing; it **does not** fall back to a local or preview project. Configure all six values before merging: automatic Git production deploys will be disabled, so missing Vercel secrets intentionally prevent new releases (the existing production deployment remains live). Do not point the opt-in multiplayer test at production.

This action deploys **versioned database migrations** and the **production application**, in that order. It does not configure hosted Auth URLs/SMTP, provision projects, deploy Edge Functions, or manage Vercel environment-variable values. Keep `NEXT_PUBLIC_SITE_URL` set to the stable public production origin: CLI prebuilt builds do not provide every Vercel system environment variable available to Git builds. PR previews must use an isolated database/project, not production.

Keep migrations backward-compatible: the old application stays live while migrations/builds run. If a build/deploy fails after migrations succeed, the database changes remain; they are not automatically rolled back. Fix the failure and rerun the failed production workflow while its SHA is still current, or merge a fix and let its successful checks trigger the next release. Never mark an unapplied migration as applied to bypass a failure. If history drifts, verify the existing schema before repairing only already-applied versions. Back up the production database and review migrations before merge. Manual dashboard/CLI production deployments bypass this workflow; restrict those permissions operationally.

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

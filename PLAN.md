# Virtual Tabletop Implementation Plan

## Goal

Build a desktop-browser, system-agnostic virtual tabletop for one GM and roughly 2–8 players per game. Host the application on Vercel, using Supabase for authentication, Postgres, private image storage, and realtime updates. Prefer low-cost infrastructure.

## Confirmed requirements

- Users can belong to multiple games. Each game's creator is its GM; invited members are players in that game.
- Use email magic-link authentication initially.
- Save game state between sessions and synchronize shared changes live.
- Support multiple scenes, uploaded backgrounds and token images, and multiple characters per player.
- GMs control all tokens; players control tokens assigned to them.
- GMs calibrate scene distances; everyone can measure straight-line distances using the scene's units.
- Include manual fog reveal/conceal and independently hidden tokens.
- Sheets have customizable sections, text, numeric fields, resources, and abilities.
- GMs configure sheet permissions. Owners can edit their characters by default; NPC/enemy sheets default to GM-only.
- GMs and players can create game-local templates. Creators can copy their templates between games they belong to.
- GMs configure available dice, including arbitrary side counts.
- Support mixed dice, arithmetic, parentheses, modifiers, advantage/disadvantage, and keep-highest/lowest.
- Support saved rolls referencing sheet fields, plus manually supplied modifiers.
- Public rolls are visible to game members. Private player rolls are visible to their author and GM; private GM rolls are GM-only.
- Mobile support and grid snapping are deferred.

## Technical approach

- Next.js and TypeScript for the application, deployed on Vercel.
- React Konva for scene rendering, tokens, measurement, and GM fog editing.
- Supabase Auth, Postgres, private Storage buckets, and authorized Realtime channels.
- Postgres is authoritative. Client rendering may be optimistic, but mutations must be authorized and persisted.
- Enforce membership, ownership, and visibility in backend operations and row-level security, rather than relying on disabled UI controls.
- Keep service credentials server-side. Validate uploads, structured sheet content, and dice expressions.
- Use bounded upload sizes and realtime traffic; avoid continuously running application servers.

## Phase 1 — Foundation, accounts, and game rooms

### Steps

1. Initialize Git and a feature branch; scaffold the application, package scripts, formatting, linting, type checking, and test infrastructure.
2. Document local configuration and environment variables; configure Supabase migrations and local development.
3. Implement magic-link login, auth callbacks, session handling, logout, and expired-link recovery.
4. Create profiles, games, memberships, and invitation records.
5. Make game creation and GM membership creation atomic. Derive roles from game membership, never a global user role.
6. Add game dashboard, room creation, invitation creation/revocation, and authenticated invitation acceptance.
7. Enforce invitation expiration and prevent duplicate memberships or client-selected GM roles.
8. Establish shared backend authorization helpers and row-level security policies.

### Deliverables

- Authenticated application shell and multi-game dashboard.
- Working GM invitation flow.
- Versioned database schema and setup documentation.

### Acceptance checks

- A user can GM one game and play in another.
- Only the room creator receives the initial GM role.
- Revoked/expired invitations cannot grant access.
- Nonmembers cannot read or mutate another game's records.

## Phase 2 — Sheets, permissions, and templates

### Steps

1. Define actors, actor ownership/control assignments, sheet access grants, and versioned sheet schemas.
2. Support player characters, NPCs, and enemies without coupling fields to a specific game system.
3. Build section and field editors for text, numbers, resource counters, and abilities; allow custom titles and ordering.
4. Give fields stable identifiers so renaming labels does not break later saved-roll references.
5. Implement sheet creation, editing, persistence, and multiple characters per player.
6. Add GM-managed view/edit grants. Keep GM access authoritative and NPC/enemy sheets GM-only by default.
7. Add template creation, browsing, and sheet creation from templates for both roles.
8. Allow creators to copy their templates between games they belong to. Avoid copying restricted actor content or unrelated permissions.
9. Treat new sheets as independent template copies; template edits do not silently rewrite existing sheets.
10. Add revision checks and conflict feedback to prevent silent overwrites during concurrent editing.

### Deliverables

- System-agnostic sheet editor and viewer.
- Per-sheet permission management.
- Game-local reusable templates and creator-controlled cross-game copies.

### Acceptance checks

- D&D-style actions/bonus actions/reactions and Pathfinder-style actions can be modeled without code changes.
- Numeric statistics, hit points, and current/maximum spell-slot counters persist correctly.
- Unauthorized sheet reads and writes fail through direct backend requests as well as the UI.
- Template copies preserve structure and values without inheriting source-game access grants.

## Phase 3 — Scenes, tokens, measurement, and synchronization

### Steps

1. Create scene, image asset, token, and active-scene records, separating actor data from token placement.
2. Implement validated uploads to private storage with file-size, image-dimension, and supported-format limits.
3. Build GM scene creation, background selection, scene switching, and scene management.
4. Build pan/zoom rendering and store token coordinates in scene space, independent of viewport size.
5. Allow uploaded token images, actor-token association, placement, resizing, and movement.
6. Authorize GM movement for all tokens and player movement for assigned characters only.
7. Add scene calibration: draw a line, enter a positive distance, and choose a unit label.
8. Add straight-line measurement that remains accurate at different zoom levels.
9. Persist completed movements; use throttled authorized realtime previews during dragging.
10. Synchronize active-scene changes and token state; reconcile clients with persisted state after reconnecting.

### Deliverables

- Shared multi-scene tabletop with persistent tokens.
- GM scene controls and player character movement.
- Calibrated ruler for all participants.

### Acceptance checks

- Two browser sessions see scene switches and token movement live.
- Refreshing or reconnecting restores the authoritative scene and positions.
- Players cannot move unassigned tokens by forging requests.
- Measurements match calibration regardless of zoom or pan.
- Concurrent movement has a defined resolution and cannot restore an older persisted position accidentally.

## Phase 4 — Fog of war and hidden content

### Steps

1. Define persisted reveal/conceal regions and independent token visibility flags.
2. Add GM-only reveal/conceal tools, a full-map GM view, and a player-view preview.
3. Produce player-safe masked background images or tiles server-side; do not expose the original concealed image through player URLs or payloads.
4. Prototype masking within Vercel runtime/memory limits before finalizing supported map dimensions and rendering granularity.
5. Cache masked outputs by scene and visibility revision; invalidate access to obsolete outputs as appropriate.
6. Filter hidden tokens, actor links, and movement events before delivery to players, including realtime previews.
7. Hide player token rendering outside revealed regions; explicit GM-hidden status takes precedence over revealed terrain.
8. Synchronize visibility revisions and ensure newly connected clients receive the current authorized view.
9. Document that concealment prevents future delivery but cannot erase imagery a player already saw or saved.

### Deliverables

- Manual persistent fog editing and hidden-token controls.
- Authorized player map assets and filtered token subscriptions.

### Acceptance checks

- Inspecting player network responses does not reveal currently undisclosed map imagery, hidden tokens, or restricted sheets.
- Reconnecting, changing scenes, and requesting storage assets preserve access boundaries.
- GM-only token movement does not leak via realtime traffic.
- Fog updates remain usable within the chosen upload and hosting limits.

## Phase 5 — Dice engine, privacy, and saved rolls

### Steps

1. Define a documented expression grammar and structured roll results.
2. Implement bounded parsing for dice terms, numeric constants, parentheses, addition, subtraction, multiplication, and division. Never execute expressions as code.
3. Define precedence, unary negatives, decimal division, division-by-zero errors, and invalid-expression feedback.
4. Add arbitrary positive integer die sizes, mixed dice, keep-highest/lowest, and advantage/disadvantage shortcuts.
5. Add GM dice configuration and enforce allowed die sizes for all game rolls on the server.
6. Generate outcomes server-side with a cryptographically secure random source and limits on sides, dice counts, expression length, and computational complexity.
7. Store individual die outcomes, kept/discarded results, resolved modifiers, expression, total, author, character attribution, and visibility.
8. Build a dice panel with public/private selection, manual modifiers, and readable roll history.
9. Add saved ability rolls referencing stable sheet-field identifiers; resolve authorized field values at roll time and snapshot them in the result.
10. Restrict player character attribution and sheet-derived modifiers to their controlled characters. Still allow manually entered modifiers at any time.
11. Implement private-roll read policies and authorized realtime delivery. Prevent duplicate rolls from request retries using idempotency keys.

### Deliverables

- Shared dice interface and persistent permission-filtered roll history.
- Saved roll buttons on character and actor sheets.

### Acceptance checks

- Verify expressions such as `2d6 + 3`, `(1d8 + 2) * 2`, mixed dice, and keep-highest/lowest against controlled random inputs.
- Invalid syntax, missing sheet references, disallowed dice, excessive workloads, and division by zero return clear errors.
- Private player rolls are readable only by that player and the GM; private GM rolls remain GM-only.
- Realtime subscriptions and history queries enforce the same visibility rules.
- Saved roll history does not change when sheet values are subsequently edited.

## Phase 6 — Reliability, verification, and deployment

### Steps

1. Complete reconnect recovery, mutation error feedback, revision handling, and loading/empty/error states.
2. Add meaningful integration tests for membership, ownership, permission changes, private assets, private rolls, and cross-game isolation.
3. Add browser tests for a GM and multiple players: invite, create sheets, upload a scene, move tokens, measure, reveal fog, and roll dice.
4. Test revocation while sessions are connected so stale subscriptions cannot continue receiving restricted content.
5. Exercise one GM plus eight players, large supported maps, frequent movement, and repeated fog changes.
6. Tune realtime throttling, query pagination, asset caching, and image limits using observed performance and service quotas.
7. Verify desktop keyboard interaction, usable dialogs, sheet forms, and basic accessibility.
8. Configure Vercel deployments, Supabase production configuration, auth redirect URLs, migrations, and required email delivery settings.
9. Separate production and development data; document backup/export options, recovery procedures, and free-tier limitations.
10. Run lint, type checking, build, targeted tests, and end-to-end checks; fix release-blocking failures.
11. Complete setup/user documentation, commit work, push the feature branch, and open an `ai-coded` PR for human review once a GitHub remote is available.

### Deliverables

- Deployable, documented first release.
- Automated coverage for critical gameplay and authorization boundaries.
- Reviewed deployment configuration and measured low-cost operating constraints.

### Acceptance checks

- A complete GM/player session works across independent browsers and survives disconnects and reloads.
- No unauthorized cross-game, private-roll, hidden-token, or concealed-map access is found in the defined test cases.
- The configured desktop group size is usable within documented limits.
- Production deployment passes login and multiplayer smoke tests.

## Implementation sequencing

- Complete phases in order; authorization tests accompany each feature rather than waiting for Phase 6.
- Phase 3 establishes the tabletop foundation, but player map delivery is not release-ready until Phase 4 is complete.
- Maintain migrations and environment documentation alongside each infrastructure change.
- Use small, reviewable commits on the feature branch and keep credentials out of source control.

## Deferred scope

- Mobile layouts and touch-specific tabletop controls.
- Grid snapping and grid-dependent movement rules.
- Automatic vision, dynamic lighting, and line-of-sight fog.
- Ruleset-specific automation and globally published template catalogs.

## Unresolved Questions

- None blocking implementation.
- Setup requires a GitHub destination, Vercel project, and Supabase project credentials.

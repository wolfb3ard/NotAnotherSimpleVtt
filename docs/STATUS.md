# Implementation status

## Built

- Phase 1: application foundation, magic-link authentication, game-scoped roles, invitations, dashboard, and authorization migrations.
- Phase 2: actor sheets, customizable fields/resources/abilities, grants, templates, copies, and revision checks.
- Phase 3: uploaded scenes/tokens, scene switching, assigned movement with live persisted checkpoints, pan/zoom, calibration, ruler, and reconciliation.
- Phase 4: manual fog, hidden tokens, GM player-view preview, server-side sanitized map rendering, private revision cache, and token filtering.
- Phase 5: bounded server-side dice engine, custom die configuration, manual/sheet modifiers, saved rolls, private/public history, and idempotent retry identifiers.
- Phase 6: automated checks, database authorization tests, browser smoke tests, an opt-in multiplayer browser test, CI, deployment and operations documentation.
- 3D dice extension: standard numbered polyhedra, arbitrary-die question-mark visuals, anonymous private-player cues, GM-private silence, and per-user material controls with a live preview.

## Verified locally

- Production build, TypeScript, lint, and formatting.
- Unit/database tests exercise arithmetic, validation, concealed image pixels, movement coalescing, real Postgres RLS, invitation validity, revision conflicts, template ownership, roll privacy, cross-game isolation, and hidden-token access.
- Browser smoke tests exercise public navigation, invalid invitations, and invalid data-route identifiers.
- Full Playwright session passed against local Supabase with one GM and eight players, including private-player cue access, silent private GM rolls, customized dice appearance, scene movement, and persisted roll history.

## Still requires configured infrastructure

- Repeat the multiplayer browser suite against an isolated hosted Supabase test project; it is opt-in and passed against local Supabase.
- Verify production email delivery, auth callbacks, private Storage HTTP access, and Realtime delivery/reconnect behavior.
- Test one GM plus eight players and benchmark representative large maps/fog edits on Vercel.
- Configure production Supabase, SMTP, Vercel environment variables, and deployment URLs; deploy and run production smoke checks.

These infrastructure checks remain release gates; local PGlite tests are not a substitute for hosted Supabase verification.

## Deferred

Mobile tabletop support, grid snapping, automatic vision/lighting, ruleset automation, global template catalogs, automated storage cleanup, and paginated browsing of older rolls.

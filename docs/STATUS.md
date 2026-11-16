# Implementation status

## Built

- Token quick-actions follow-up: removed the character sheet's Play resources panel; token right-click opens a condensed resource/health card with a keyboard chooser, movable/clamped window, permission filtering, immediate-save/retry feedback and cross-window draft guards. Existing sheet Use/Recover buttons remain immediate. [PR #27](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/27) ready for review; not merged.

- VTT v2 Epic 01: single-click character cards, persistent owned-character shortcuts, and synchronized roll-visibility controls with explicit audience descriptions. Roadmap and per-epic tasks: [vtt_v2.md](../vtt_v2.md).
- VTT v2 Epic 02: immediate authorized resource/feature-use saves, atomic Damage/Heal previews with temporary HP, serialized rapid edits, revision/idempotency protection, visible failure/retry, and isolated configuration drafts. Apply the new resource migration before deployment.
- VTT v2 Epic 03: bounded private server undo history, revision-checked inverses for committed token moves and painted/full-scene fog, Ctrl/Cmd+Z outside typing, and persisted uncertain-operation retries. Apply the reversible-tabletop migration before deployment. [PR #26](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/26) ready for review; not merged.

- Phase 1: application foundation, Google authentication (Discord backend retained; button hidden), game-scoped roles, invitations, dashboard, and authorization migrations.
- Phase 2: actor sheets, customizable fields/resources/abilities, grants, templates, copies, and revision checks.
- Phase 3: uploaded scenes/tokens, scene switching, assigned movement committed on drop, pan/zoom, calibration, ruler, and reconciliation.
- Phase 4: manual fog, hidden tokens, GM player-view preview, server-side sanitized map rendering, private revision cache, and token filtering.
- Phase 5: bounded server-side dice engine, custom die configuration, manual/sheet modifiers, saved rolls, private/public history, and idempotent retry identifiers.
- Phase 6: automated checks, database authorization tests, browser smoke tests, an opt-in multiplayer browser test, CI, deployment and operations documentation.
- 3D dice extension: standard numbered polyhedra, arbitrary-die question-mark visuals, anonymous private-player cues, GM-private silence, and per-user material controls with a live preview.
- Owner/GM-only character deletion with confirmation/revision protection; tokens and grants removed while roll history and templates remain.
- Detachable, movable/resizable in-VTT roll window; recorded roll purpose and snapshotted character attribution.
- Source-traceable SRD 5.2.1 catalog and guided character creation/progression through level 20, including multiclass choices, feats, spell lists, class resources, and separate Pact Magic.

## Verified locally

- Token quick-actions follow-up: 372 unit/database/component tests, lint, TypeScript, production build, full formatting with `--end-of-line auto`, and six Edge auth/smoke tests passed after reconciling merged Epic 03. Coverage includes right-click versus left-click, keyboard access, condensed layout, GM/owner/edit-grant permissions, controller/view-only denial, revoked access, immediate saves/retries, dirty-sheet guards, pending close/switch warnings, and scene/token removal. Updated multiplayer resource/reload checks were not run. No schema changes.

- VTT v2 Epic 03: 361 unit/database/component tests, lint, TypeScript, production build, six Edge auth/smoke tests, and full formatting with `--end-of-line auto` passed. Tests exercise private inverses, revisions, retry deduplication, bounded/expired history, revoked permissions/membership, concealed destinations, reconnect/reload, scene switching, shared fog controls, and typing-safe keyboard undo. Updated opt-in multiplayer Undo scenarios were not run. No hosted migration applied.

- VTT v2 Epic 02: 327 unit/database/component tests, lint, TypeScript, production build, six Edge auth/smoke tests, and full formatting with `--end-of-line auto` passed. Tests cover rapid edits, stale editors, atomic rollback, deduplicated retries, revoked grants, controller-only denial, generic counters, feature uses, grouped Hit Dice, offline reload, remote renames, reconnect reconciliation, and dirty/pending sheet guards. Hosted resource/multiplayer verification remains outstanding; the opt-in browser scenario now checks immediate generic-counter saves across reload but was not run for this epic. No hosted migration applied.

- VTT v2 Epic 01: 294 unit/database tests, lint, TypeScript, production build, and six browser auth/smoke tests (Edge) passed. Changed-file formatting passed; full formatting passed with `--end-of-line auto` (default check flags pre-existing CRLF files on Windows). Updated multiplayer single-click scenarios still require the opt-in isolated infrastructure run.

- Production build, TypeScript, lint, and formatting.
- Unit/database tests exercise arithmetic, validation, concealed image pixels, movement coalescing, real Postgres RLS, invitation validity, revision conflicts, template ownership, roll privacy, cross-game isolation, and hidden-token access.
- Browser smoke tests exercise public navigation, invalid invitations, and invalid data-route identifiers.
- SRD extension tests cover every class at every level, multiclass choices, source-specific casting, equipment/variants, draft isolation, real create/save RPC validation, attunement limits, deletion authorization, and preserved roll attribution. Newly extended multiplayer/browser-builder scenarios still require an isolated Supabase test project.
- Full Playwright session passed against local Supabase with one GM and eight players, including private-player cue access, silent private GM rolls, customized dice appearance, scene movement, and persisted roll history.

## Still requires configured infrastructure

- Repeat the multiplayer browser suite against an isolated hosted Supabase test project; it is opt-in and passed against local Supabase.
- Verify live Google sign-in, invitation callbacks, existing-account identity linking, private Storage HTTP access, and Realtime delivery/reconnect behavior.
- Test one GM plus eight players and benchmark representative large maps/fog edits on Vercel.
- Configure production Supabase OAuth providers, Vercel environment variables, and deployment URLs; deploy and run production smoke checks. Email delivery is not needed for application login.

These infrastructure checks remain release gates; local PGlite tests are not a substitute for hosted Supabase verification.

## Deferred

Mobile tabletop support, grid snapping, automatic vision/lighting, a complete tactical/condition rules engine, global template catalogs, automated storage cleanup, and paginated browsing of older rolls. See the SRD catalog manifest for explicit builder-automation limits; this is not independently audited as a complete rules implementation.

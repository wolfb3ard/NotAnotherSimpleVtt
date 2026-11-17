# Implementation status

Progress reconciled on 2026-11-17. Epics 01–05 are merged; Epic 06 is implemented awaiting review/merge, and Epic 07 still has only a partial quick-actions foundation. Merge status does not establish hosted deployment or acceptance verification.

## Built

- VTT v2 Epic 06: private actor conditions/source/notes, manual removal/editing, persistent start/end-of-own-turn expiry reviews, concentration loss reminders/manual outcomes, death-save rolls/counters and explicit stabilize/recovery resets. Tracker/token summaries require sheet access. Independent combat revisions, game-serialized authorization and exact persisted retries preserve shared state without adjudicating rules. Apply `20261117134351_combat_bookkeeping.sql` before deployment. [PR #36](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/36) ready for review; not merged.

- VTT v2 Epic 05: scene-scoped encounters, selected-token initiative with atomic private server rolls, manual scores/ties/order, participant changes, GM-only turns/rounds, pause/resume/end, filtered player trackers, active-token markers and persistent Your turn cues. Apply `20261116210025_encounter_initiative.sql` before deployment. [PR #31](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/31) merged on 2026-11-16.

- VTT v2 Epic 04: all 336 SRD monster stat blocks, GM library-to-board group creation, independent sheets/resources, source-linked appearance with instance overrides, explicit legacy-linked placement, monster attack/critical/check/save/spell controls and manual casting/use/recharge. Apply `20261116202045_encounter_creatures.sql` before deployment. [PR #28](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/28) merged on 2026-11-16.

- Monster-sheet usability follow-up: compact player-style combat header, quick checks, accessible tabs, grouped action/critical/recharge rolls, shared d20 mode, collapsed rules/source and deduplicated casting restrictions. Saved/customized controls and independent resources remain intact. [PR #32](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/32) merged on 2026-11-16. No schema changes.

- Token quick-actions follow-up: removed the character sheet's Play resources panel; token right-click opens a condensed resource/health card with a keyboard chooser, movable/clamped window, permission filtering, immediate-save/retry feedback and cross-window draft guards. Existing sheet Use/Recover buttons remain immediate. [PR #27](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/27) merged on 2026-11-16. Partial E07 delivery; token Attack/Conditions/Initiative shortcuts and the complete unified action menu remain outstanding.

- Production deployment follow-ups: [PR #29](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/29) and [PR #30](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/30) merged on 2026-11-16. Production builds run remotely on Vercel after migrations, avoiding downloaded Secret placeholders in Next.js public configuration; the access preflight uses the configured project without `vercel link`'s failing user lookup. Live production recovery is not asserted by this documentation update.

- VTT v2 Epic 01: single-click character cards, persistent owned-character shortcuts, and synchronized roll-visibility controls with explicit audience descriptions. Roadmap and per-epic tasks: [vtt_v2.md](../vtt_v2.md).
- VTT v2 Epic 02: immediate authorized resource/feature-use saves, atomic Damage/Heal previews with temporary HP, serialized rapid edits, revision/idempotency protection, visible failure/retry, and isolated configuration drafts. Apply the new resource migration before deployment.
- VTT v2 Epic 03: bounded private server undo history, revision-checked inverses for committed token moves and painted/full-scene fog, Ctrl/Cmd+Z outside typing, and persisted uncertain-operation retries. Apply the reversible-tabletop migration before deployment. [PR #26](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/26) merged on 2026-11-16.

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

- VTT v2 Epic 06: 486 unit/database/component tests, production build/TypeScript, lint, native-line-ending formatting and six Edge auth/smoke tests passed. PGlite applies all migrations and exercises validation, direct-write denial, private projections, revoked grants/retries, stale writes, own-turn start/end duration reviews, pause/end, six same-definition independent creatures, PC/monster HP and temporary-HP reminders, retry deduplication and recovery overrides. Components cover source/notes edits, read-only/dirty guards, death rolls, durable retry after reload and manual check outcomes. The updated opt-in multiplayer scenario is skipped. No hosted migration applied; local Supabase advisors could not connect to the unavailable local stack.

- Latest merged implementation ([PR #32](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/32)): 455 unit/database/component tests, production build/TypeScript, lint, formatting with `--end-of-line auto`, and six Edge auth/smoke tests passed. Catalog-wide tests retain every action, roll and editable field exactly once for all 336 monsters; component tests cover keyboard tabs, independent IDs, roll mode, immediate HP writes, blocked actions, renamed/customized expressions, continued sections, orphaned rolls and homebrew spells. Isolated wide/narrow browser checks found no horizontal overflow or console errors. The opt-in multiplayer test was skipped; no hosted data changed. Earlier counts below are historical per-epic checks, not the current suite total.

- VTT v2 Epic 05: 446 unit/database/component tests, lint, TypeScript, production build, six Edge auth/smoke tests and full formatting with `--end-of-line auto` passed. Tests cover hidden/fogged projections, denied raw table/forged roll access, GM-only advancement, concurrent/stale turns, source/dice-setting races with batch rollback, idempotent rolls, manual/tie ordering, removal/deletion reconciliation, paused/ended states, per-scene persistence, same-tab retries and late-response isolation. The authenticated multiplayer scenario is extended but not run; local Docker/Supabase and advisors are unavailable. No hosted migration applied.

- VTT v2 Epic 04: 407 unit/database/component tests, lint, TypeScript, production build, six Edge auth/smoke tests, PDF import/check and full formatting with `--end-of-line auto` passed. PDF inventory counts all 336 headings and type/AC pairs, including six spell/item creatures, and retains raw text. All generated sheets pass application and Postgres validation. Tests cover six goblins, independent damage/uses, permissions, stale revisions, creation/resource retries, same-tab reload, GM-role loss, appearance inheritance/override, source/game deletion and casting controls. Multiplayer browser coverage is extended but not run; Docker/Supabase advisors are unavailable locally. No hosted migration applied.

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

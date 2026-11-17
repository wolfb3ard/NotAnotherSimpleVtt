# VTT v2 — Remote D&D usability

## Goal

Make preparation, joining, navigation, and ordinary D&D turns understandable without a tutorial. Preserve system-agnostic sheets, existing campaigns, manual overrides, and server-enforced secrecy.

## Delivery rules

- One feature branch and reviewable PR per epic; never merge automatically.
- Work in the sequence below. After an epic's PR is ready, notify the owner and wait for merge before starting dependent work.
- Update this document's tasks, checks, and PR links in each epic.
- Extend existing play/edit sheets and immediate sheet rolls rather than replacing them.
- Existing games must remain valid. Database changes need backward-compatible migrations and authorization tests.
- Never send GM secrets, hidden combatants, concealed positions, or private notes to players.
- Shared state stays server-authoritative, revision-checked, and reconciled after reconnect. Retryable operations need idempotency.
- Assistance must explain changes, offer manual overrides, and avoid claiming full rules automation.
- Desktop first. Mobile support, integrated voice/video, and a complete rules engine are not prerequisites.

## Progress snapshot — 2026-11-17

- Epics 01–08 are complete and merged into `main`. Phases 1 and 2 are complete; Epic 09 continues Phase 3.
- Epic 06 (conditions, concentration, death saves) merged in [PR #36](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/36) on 2026-11-17.
- Epic 07 merged in [PR #37](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/37) on 2026-11-17 (commit `65787f4`).
- Epic 08 merged in [PR #38](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/38) on 2026-11-17 (commit `a6447f1`).
- Epic 09 adds shared grid calibration, optional snapping, Euclidean drag feedback, Space-pan, room help and browser-local scene viewports; review PR pending publication.
- Follow-ups merged: token quick actions [#27](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/27), production deployment fixes [#29](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/29)/[#30](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/30), compact monster sheets [#32](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/32).
- Latest local implementation verification: E09's 549 unit/database/component tests, production build/TypeScript, lint, native-line-ending formatting, and six Edge auth/smoke tests passed. The opt-in multiplayer scenario was skipped.
- Complete means merged, not hosted acceptance verified. Historical per-epic test counts below describe their original implementation checks; hosted migration, multiplayer, privacy, and performance verification remain separate release gates.

## Current foundation

`src/components/room.tsx` owns room panels, synchronization, shared roll settings, and sheet windows. `tabletop.tsx` provides pan/zoom, Fit map, calibration, manual fog, token controls, and player preview. `sheet-editor.tsx`, `dnd-sheet.tsx`, and `dnd-tabs.tsx` already support play/edit views, structured D&D actions, and immediate sheet rolls. Actor ownership, grants, and token control are separate permissions.

At the v2 planning baseline: character cards require double-click; roll settings disappear behind other panels; quick resource edits require Save sheet; tokens start near the top-left; linked monster tokens share sheet stats. Presence, initiative, preparation notes, and tactical templates need new capabilities.

## Phase 1 — Discoverable, dependable interaction

### Epic 01 — Character access and roll-privacy clarity

Status: Complete; [PR #21](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/21) merged into `main` on 2026-11-16 (commit `3eda344`). Dependencies: none.

- [x] E01-T01: Open compact character cards with one click; retain Enter/Space and dirty-sheet guards.
- [x] E01-T02: Add a persistent My character shortcut; handle multiple characters and explain the empty state.
- [x] E01-T03: Keep roll visibility and its actual audience visible outside Dice; synchronize all roll controls.
- [x] E01-T04: Test mouse/keyboard activation, ownership filtering, multiple characters, dirty switching, and public/private rolls.
- [x] E01-T05: Update user documentation; run checks; publish an `ai-coded` PR.

Acceptance: an owner can open their character and identify/change the audience of a sheet roll without leaving another panel. No shortcut grants access or bypasses unsaved-change confirmation.

Local verification: 294 unit/database tests, lint, typecheck, production build, and six browser auth/smoke tests (Edge) passed. Full formatting passes with `--end-of-line auto`; the default Windows check reports pre-existing CRLF files. Multiplayer scenarios were updated for single-click activation but the infrastructure-dependent suite was not run for this epic. No schema changes.

### Epic 02 — Reliable quick updates and play-focused resources

Status: Complete; [PR #23](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/23) merged into `main` on 2026-11-16 (commit `bf92fa6`). Dependencies: E01 (merged).

- [x] E02-T01: Inventory existing quick-edit and configuration paths; define which changes save immediately.
- [x] E02-T02: Add atomic, authorized resource adjustments with revision checks; preserve generic sheets.
- [x] E02-T03: Persist play-mode HP/counter changes immediately; show Saving, Saved, Failed, and Retry states.
- [x] E02-T04: Preserve explicit Apply/Save for builder and configuration drafts; avoid overwriting unsaved edits.
- [x] E02-T05: Add Damage and Heal actions with previews, temporary HP handling, and manual overrides.
- [x] E02-T06: Test rapid edits, concurrent editors, rollback/retry, revoked access, reload, and reconnect.

Acceptance: routine resource use does not require configuration mode or a whole-sheet save; failures never look saved.

Inventory/save policy: `sheet-editor.tsx` previously drafted generic current/max values; `dnd-sheet.tsx` drafted HP, class counters and grouped Hit Dice; `dnd-tabs.tsx` drafted feature uses and spell-slot Use/Recover actions. Current values and feature uses save through token quick actions/the existing Use/Recover buttons; compact monster sheets also expose immediate HP/temporary HP controls. Field definitions/maxima, names, inventory, biography, preparation, exhaustion and builder configuration remain Apply/Save drafts. Dirty configuration blocks quick updates; pending/unconfirmed resources block configuration and participate in close/switch guards.

Merged follow-up: [PR #27](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/27), 2026-11-16 (commit `0be7c93`), moved Play resources off character sheets into a condensed, movable token quick-actions card. Right-click and a keyboard chooser expose health/resource controls, immediate save/retry feedback, permission filtering, and cross-window draft guards. This delivers part of E07, not the complete epic.

Local verification: 327 unit/database/component tests, lint, TypeScript, production build, and six browser auth/smoke tests (Edge) passed. Full formatting passes with `--end-of-line auto`. Revision, permission, atomicity and retry tests run against all migrations in local PGlite; component tests cover rapid edits, rollback, dirty drafts, offline reload, remote renames and reconnect reconciliation. The opt-in multiplayer browser scenario now checks generic quick saves across reload, but was not run for this epic. No hosted migration was applied. Migration: `20261116152232_quick_actor_resources.sql`.

### Epic 03 — Reversible tabletop edits

Status: Complete; [PR #26](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/26) merged into `main` on 2026-11-16 (commit `0acac34`). Dependencies: E02 (merged).

- [x] E03-T01: Define a bounded, per-user undo history for committed token moves and fog edits.
- [x] E03-T02: Add revision-checked inverse operations; reject undo that would overwrite another user's later change.
- [x] E03-T03: Expose Undo with action descriptions and keyboard support outside text inputs.
- [x] E03-T04: Explain unsupported/expired undo and unconfirmed network operations.
- [x] E03-T05: Test fog privacy, concurrent movement, retries, permissions, and scene switching.

Acceptance: an accidental move/reveal can be reversed without corrupting newer state. Explain that undo cannot erase information already seen.

History policy: last 20 receipts per user/game, including undone actions, retained for 24 hours with lazy expiry. Active-scene history contains authorized metadata only. Drags commit once on drop; painted fog and full-scene reveal/conceal share the same queue. Full revisions prevent overwriting newer moves, fog, or configuration. Consecutive own undos rebase only an unbroken revision chain. Exact operation retries are idempotent; uncertain requests survive same-tab reload via scoped session storage when available. No redo; unsupported operations are documented. Undo cannot erase information already seen.

Local verification: 361 unit/database/component tests, lint, TypeScript, production build, six Edge auth/smoke browser tests, and full formatting with `--end-of-line auto` passed. PGlite applies all migrations and tests private fog inverses, consecutive undo, stale/concurrent writes, expired/pruned receipts, idempotent forward/undo retries, revoked control/membership, concealed destinations, cross-game access and scene switching. Component tests cover shared full-scene fog controls, pending/retry/reload, reconnect, late scene responses, explicit dismissal and typing-safe shortcuts. The updated opt-in multiplayer scenario covers move Undo after reload and conceal/restore, but was not run for this epic. No hosted migration applied. Migration: `20261116161714_reversible_tabletop.sql`.

## Phase 2 — Encounter-ready play

### Epic 04 — SRD monster library and independent encounter creatures

Status: Complete; [PR #28](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/28) merged into `main` on 2026-11-16 (commit `0f9c50e`). Dependencies: E02 (merged).

- [x] E04-T01: Define reusable monster definitions versus independent encounter actors; keep PC state shared across scenes.
- [x] E04-T02: Add backward-compatible instance creation with independent HP/resources/conditions and linked appearance.
- [x] E04-T03: Provide Add N creatures, automatic unique labels, and Duplicate as independent creature.
- [x] E04-T04: Make shared versus independent state explicit; do not silently reinterpret existing linked tokens.
- [x] E04-T05: Test six goblins taking independent damage, template changes, deletion, retries, RLS, and reconnect.
- [x] E04-T06: Build a complete, versioned monster library from `SRD_CC_v5.2.1.pdf`; retain source/page references and required CC attribution. Verify every monster and stat-block variant against the document, not another SRD edition.
- [x] E04-T07: Preserve each published stat block in full: names, descriptive fields, statistics, defenses, senses, languages, challenge/XP, traits, actions, bonus actions, reactions, legendary actions, spellcasting, and any other printed sections. Retain exact rules text, values, formulas, and special limitations; do not silently simplify unsupported mechanics.
- [x] E04-T08: Let the GM search/filter the complete SRD monster library, inspect a stat block, and add one or multiple independent creatures directly to the current board. This basic library-to-board flow ships in Phase 2, not Phase 4.
- [x] E04-T09: Open a monster's sheet from its token with the same applicable play/edit capabilities as a player sheet: change portrait/token image, edit statistics, adjust HP/resources, roll ability checks/saves, roll attacks and damage, and use traits/actions. Preserve a source-accurate base definition; clearly distinguish encounter edits and image overrides from library content and other instances.
- [x] E04-T10: Make every monster's printed spells accessible from its sheet with rules text and immediate casting/attack/damage/save-DC controls as applicable. Support the monster's actual casting rules, including at-will, limited-use, and slot-based casting where printed; track uses/recharge independently and provide manual overrides. Do not require a PC class/level or defer basic monster casting to E14's advanced assistance.
- [x] E04-T11: Keep monster sheets, unrevealed tokens, and private rolls GM-only by default; honor explicit sheet-access/control grants and existing roll audiences without revealing full stat blocks merely because a token is visible.
- [x] E04-T12: Validate library completeness and exact stat-block fidelity against the PDF; test representative spellcasters, multiattack, recharge/limited-use abilities, unusual/legendary actions, image changes, attack/damage/casting controls, permissions, and independent resources across reload/reconnect. Keep unsupported automation explicitly manual while retaining the complete printed rules.
- [x] E04-T13: Match the player sheet's compact combat header and accessible tabs; group action rolls, collapse rules/source, and deduplicate casting restrictions without losing saved/customized controls.

Acceptance: the GM can select any monster/stat-block variant in `SRD_CC_v5.2.1.pdf`, add it directly to the board, and open a source-accurate, fully usable monster sheet. Applicable player-sheet controls work for monsters, including image changes, attack/damage rolls, and spellcasting. Adding a group never requires manually creating six sheets; damaging or spending a use on one creature does not affect the others. Exact stat-block content is required; full rules automation is not.

Implementation policy: all 336 printed blocks (including six spell/item creatures) are imported with raw text, source pages and a PDF fingerprint; an independent type/AC inventory verifies the count. GM group creation adds 1–20 hidden, independently owned actor/token pairs with unique labels and durable idempotency receipts. Existing linked placements and cross-scene PCs are unchanged. Custom definitions propagate only appearance until an instance override; sheets/grants never propagate. Cast/action declarations are recorded explicitly; use expenditure, recovery, targeting and conditional rules remain manual. Printed spell DCs/attacks and simple explicitly printed higher-level damage scaling are supported. Summoner/size-dependent formulas remain intact and require configuration before play; unresolved HP starts at 0. See README for operating limits.

Local verification: 407 unit/database/component tests, lint, TypeScript, production build, six Edge auth/smoke tests, PDF import/check and full formatting with `--end-of-line auto` passed. All 336 generated sheets pass application and Postgres validation. Migration: `20261116202045_encounter_creatures.sql`. No hosted migration applied. Authenticated multiplayer scenarios are extended but remain unrun; local Docker/Supabase and advisors are unavailable.

Merged layout follow-up: [PR #32](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/32), 2026-11-16 (commit `cc4cd4a`). Monster sheets now use portrait/name and combat essentials, quick ability checks, one d20 roll-mode selector, and Actions/Spell/Abilities/Features & Traits/Resources/Notes & Source tabs. Action, damage, critical and recharge rolls are grouped; full rules and source are collapsed. All 336 monsters retain every generated action, roll and editable field exactly once; customized expressions, continued sections, orphaned rolls and homebrew spells remain usable. Verification: 455 tests, lint, production build/TypeScript, native-line-ending formatting and six Edge smoke tests passed; wide/narrow browser checks found no horizontal overflow or console errors. No schema changes.

### Epic 05 — Initiative and encounter lifecycle

Status: Complete; [PR #31](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/31) merged into `main` on 2026-11-16 (commit `4580ae4`). Dependencies: E04 (merged).

- [x] E05-T01: Model encounters, participants, initiative, round, and active turn with authorized server operations.
- [x] E05-T02: Start an encounter from selected tokens; roll initiative through the existing authoritative dice service.
- [x] E05-T03: Support manual initiative, tie resolution, reorder, add/remove participants, pause/resume, and end.
- [x] E05-T04: Display turn order; highlight the active token and show a clear Your turn cue.
- [x] E05-T05: Define player turn-advance permissions; hide secret combatants and GM-only statistics.
- [x] E05-T06: Test concurrent turn advancement, idempotent rolls, refresh/reconnect, hidden participants, and multiple scenes.

Acceptance: GM and players agree on turn/round; secret enemies do not leak through tracker payloads or events.

Implementation policy: one live encounter per scene, up to 50 selected board tokens. GM-only advancement; players have a filtered read-only tracker and persistent Your turn cues for visible owned/controlled tokens. Automatic initiative uses saved rules through the existing server dice engine and private roll recorder, committing the batch/order/receipt atomically with source revisions. Manual totals are required for missing rules. Sorting is descending with stable ties; explicit reorder, score changes, additions and rerolls preserve the active token. Removing the current participant advances to the next survivor and wraps rounds; empty encounters pause. Scene switching retains independent state. Hidden/fogged participants, current IDs, indices, private revisions, counts and sheet statistics are omitted from player projections; non-visible turns display only Waiting for GM. No automatic resource/condition recovery or turn undo. Retries persist exact requests per user/game/scene and cannot advance/reroll twice.

Local verification: 446 unit/database/component tests, lint, TypeScript, production build, six Edge auth/smoke tests and full formatting with `--end-of-line auto` passed. Tests cover filtered hidden/fogged turns, GM-only control, raw/forged-roll denial, source/dice-setting races with batch rollback, concurrent/stale advancement, retry deduplication, manual/tie order, participant deletion, pause/end, per-scene persistence, reload and late-response isolation. Migration: `20261116210025_encounter_initiative.sql`. No hosted migration applied; the opt-in multiplayer browser scenario is extended but remains unrun. Local Docker/Supabase and advisors are unavailable.

### Epic 06 — Conditions, concentration, and death saves

Status: Complete; [PR #36](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/36) merged into `main` on 2026-11-17 (commit `3315e46`). Dependencies: E05 (merged).

- [x] E06-T01: Add condition markers with source, notes, optional duration, and manual removal.
- [x] E06-T02: Support start/end-of-turn expiry prompts and overrides; do not silently adjudicate ambiguous rules.
- [x] E06-T03: Track concentration; prompt for relevant checks when damage is applied.
- [x] E06-T04: Add death-save controls and explicit recovery/reset actions.
- [x] E06-T05: Show authorized HP/condition summaries in tracker and token controls.
- [x] E06-T06: Test durations, defeated/revived creatures, hidden conditions, independent instances, and overrides.

Acceptance: combat bookkeeping is visible and editable without implying that every conditional rule is automated.

Implementation policy: combat state is actor-scoped and private to existing sheet readers; edits require GM/owner/edit-grant authorization, never token control alone. Existing actors default to empty bookkeeping. Independent creatures do not share state; linked placements/PCs retain shared state. Up to 30 editable markers include source/notes and optional exact round/start-or-end-of-own-turn timing in one encounter. Turns persist review flags, never remove markers. Other-creature/time-based/ambiguous durations remain manual. Concentration reminders infer committed D&D/monster HP/temporary-HP loss (including manual edits), suggest the 2024 DC, and require explicit outcome/removal. Actual damage, resistance, overkill and separate sources need manual adjudication; at 100 pending reminders additional losses aggregate into the last reminder. Death-save d20 rolls use the existing server roll service/audience; counters, stabilize and recovery/reset are explicit and never change HP automatically. Combat has independent revisions, game-first serialization and private idempotency receipts; exact unconfirmed requests persist in same-tab storage and use existing quick-action draft/close guards.

Local verification: 486 unit/database/component tests, lint, production build/TypeScript, native-line-ending formatting and six Edge auth/smoke tests passed. PGlite applies all migrations and tests validation, permissions/revocation, private projections, retry deduplication, stale edits, own-turn start/end timing, pause/end, six same-definition independent creatures, PC/monster HP and temporary-HP concentration prompts, and recovery overrides. Components cover marker edits, read-only/dirty guards, death rolls, persisted uncertain retries across reload and manual check outcomes. The opt-in multiplayer scenario now checks marker persistence/privacy but remains unrun. Migration: `20261117134351_combat_bookkeeping.sql`. No hosted migration applied; local advisors could not connect to the unavailable local stack.

### Epic 07 — Token quick actions

Status: Complete; [PR #37](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/37) merged into `main` on 2026-11-17 (commit `65787f4`). Dependencies: E05 and E06 (merged).

Delivered foundation: [PR #27](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/27) provides token right-click/keyboard quick actions, Open sheet, Damage/Heal, resources, save/retry feedback and permission/draft guards. [PR #28](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/28) adds Duplicate as independent creature. [PR #31](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/31) supplies initiative through the encounter panel. E06 adds condition/survival controls.

- [x] E07-T01: Separate token selection from opening its sheet; support keyboard-accessible equivalent controls.
- [x] E07-T02: Add Sheet, Attack, Damage/heal, Conditions, and Initiative actions appropriate to permissions.
- [x] E07-T03: Add GM Hide/reveal, Duplicate, and Assign control actions.
- [x] E07-T04: Use immediate sheet rolls for simple actions and the existing panel for advanced expressions.
- [x] E07-T05: Explain blocked actions without exposing restricted sheet data.
- [x] E07-T06: Test owners, controllers, view-only members, GM preview, private rolls, and missing sheets.

Acceptance: an ordinary attack and HP adjustment can be completed from a selected token without panel hopping.

Implementation policy: click selects/highlights and opens the same movable card as right-click/the keyboard chooser; opening a sheet is explicit. D&D attacks use play-sheet formulas from saved inputs; generic/monster actions preserve saved expressions and rule descriptions. Rolls require sheet access plus GM/owner/token control, never an edit grant alone. The shared audience is shown and GM SRD monster selection defaults it to private. Advanced expressions load into Dice without rolling. GM token visibility/control/size edits remain revision-checked; duplication remains NPC/enemy-only, independent and initially hidden. Inline initiative starts/adds/rerolls/sets one token through E05's authoritative commands with private automatic rolls, revisions and persisted exact retries. GM preview closes/blocks token actions. Existing sheet/resource/combat guards remain; uncertain creation/initiative also block competing edits and participate in close warnings. No targeting, hit adjudication or automatic resource expenditure.

Local verification: 500 unit/database/component tests, lint, production build/TypeScript, native-line-ending formatting and six Edge auth/smoke tests passed. Added coverage includes click/right-click/keyboard selection, preview filtering/blocked entry, off-scene tokens, owner/GM/controller rolls, private-audience labels, edit-grant-only roll denial, missing/revoked sheets, dirty drafts, saved D&D/custom monster expressions/rules, GM revision-checked token edits, inline initiative lifecycle/manual overrides/exact retry across reload, and uncertain duplicate guards. Existing PGlite authorization/concurrency tests pass unchanged against all migrations. The opt-in multiplayer scenario now covers selected-token attack/HP without panel hopping and private-roll filtering, but remains unrun. No schema changes or hosted migrations.

## Phase 3 — Joining and moving around

### Epic 08 — Guided first session and sensible placement

Status: Complete; [PR #38](https://github.com/wolfb3ard/NotAnotherSimpleVtt/pull/38) merged into `main` on 2026-11-17 (commit `a6447f1`). Dependencies: E01, E04 (merged).

- [x] E08-T01: Add role-specific, dismissible/resumable checklists derived from actual campaign state.
- [x] E08-T02: Guide GMs through invitations, map upload, scale, party placement, and initial reveal.
- [x] E08-T03: Guide players through joining, creating/claiming a character, portrait, placement, and a test roll.
- [x] E08-T04: Make claiming a character GM-authorized; do not infer ownership from a name.
- [x] E08-T05: Add click-to-place and a GM-defined party spawn point instead of top-left placement.
- [x] E08-T06: Add Find my character; handle multiple tokens, no token, other scenes, and concealed locations safely.
- [x] E08-T07: Test new/existing games, interrupted onboarding, ownership transfer, fog, and placement retries.

Acceptance: a new group can reach a visible, controllable party on a calibrated scene without reading the README.

Implementation policy: role-specific guides derive readiness from current membership/invitations, active map, explicit calibration, assigned characters/control, portraits, visible tokens and durable own roll history. Dismissal is browser-local per user/game/role; no checklist grants permissions or blocks existing play. Existing characters are requested verbally/outside the app and assigned through the existing GM-only, revision-checked ownership controls; there is no automatic name claim or claim inbox. Map controls offer click/numeric placement or a per-scene GM-private spawn, with center fallback. Player placements require owned characters in the active scene and revealed destination space; existing concealed placements never yield coordinates/IDs. Exact placement retries are durable and survive same-tab reload when storage is available; players cannot duplicate an existing scene placement, while GMs may intentionally add linked tokens. Spawn/placement are not undoable. Find my character only centers explicitly selected visible active-scene owned/controlled tokens; absent/other-scene/concealed cases share safe GM guidance. GM preview disables placement/finding/spawn and hides spawn markers. Existing PCs/sheets/placements stay valid and unchanged.

Local verification: 517 unit/database/component tests, production build/TypeScript, lint, native-line-ending formatting and six Edge auth/smoke tests passed. New PGlite tests apply every migration and exercise private spawn/receipt access, default/explicit calibration, revealed-space placement, center fallback, scene switching, revision conflicts, exact retries, permissions and ownership transfer. Component/unit tests cover interrupted/resumed guides, ownership filtering, transformed clicks/numeric placement, default spawn, safe finding and GM preview. The opt-in multiplayer scenario is updated but remains unrun. Migration: `20261117143225_guided_first_session.sql`. No hosted migration applied; local advisors could not connect to the unavailable local stack.

### Epic 09 — Navigation, grid, and movement feedback

Status: Implemented; review PR pending publication. Dependencies: E03, E08 (merged).

- [x] E09-T01: Add configurable grid overlay, size/origin calibration, and optional snapping; keep free movement.
- [x] E09-T02: Show measured movement distance while dragging using scene scale and an explicit distance convention.
- [x] E09-T03: Add Space-drag pan without intercepting typing or breaking token dragging.
- [x] E09-T04: Make Fit map and Center on my token discoverable; document shortcuts in an in-room help panel.
- [x] E09-T05: Remember viewport per user/game/scene; clamp restored views and offer reset.
- [x] E09-T06: Test zoom/scale, grid offsets, map bounds, fog-safe centering, keyboard inputs, and reconnect.

Acceptance: players can locate their tokens and move a known distance without guessing pixel scale.

Implementation policy: square-grid visibility/cell size/origin are shared scene settings, defaulting off on existing/new maps. GM-only Apply uses game-first serialization, scene revisions and private durable idempotency receipts; exact unconfirmed requests survive same-tab reload and offer Retry/Dismiss. Grid calibration uses map pixels and does not change scene distance scale. Optional local snapping defaults off, aligns token centers to offset cell centers, and clamps destinations inside the map. Free movement, existing authoritative fog/control checks and move/fog Undo remain; grid settings are not undoable. A zoom-independent drag label and dashed line show Euclidean displacement using scene scale; uncalibrated measurements are explicitly estimates. Path length, walls, terrain, speed and alternate diagonal rules remain manual. Space held before a gesture pans in any tool, including over tokens, without intercepting inputs/buttons/editable content or interrupting token/drawing gestures. Fit map / Reset view and fog-safe Find my character remain prominent; in-room help documents navigation and undo. Viewports persist only in this browser per user/game/scene, tolerate unavailable/corrupt storage, clamp zoom/pan after restore/resize and reset through Fit map. Scene changes clear unfinished gestures/drafts; reconnect does not reset the current camera.

Local verification: 549 unit/database/component tests, production build/TypeScript, lint, native-line-ending formatting and six Edge auth/smoke tests passed. Tests cover offset/cell-center snapping, free movement and bounds, scale/zoom-independent distance, Space-pan/typing/active-gesture guards, fog-safe centering, separate user/game/scene cameras, corruption/storage failure, resize/reset/reconnect, stale grid drafts, GM preview, private receipts, exact retries and late-response isolation. PGlite applies every migration and verifies GM/member/outsider/anonymous/direct-write authorization, defaults, validation, stale editors, scene/game boundaries, and existing move/undo behavior on a configured grid. Migration: `20261117145441_navigation_grid.sql`. No hosted migration applied; local advisors could not connect to the unavailable local Supabase stack. The opt-in multiplayer scenario covers shared grid/help/camera restoration but was skipped.

### Epic 10 — Shared attention and connection confidence

Status: Planned. Dependencies: E09.

- [ ] E10-T01: Add ephemeral, rate-limited player pings with accessible labels and reduced-motion behavior.
- [ ] E10-T02: Add an explicit GM Bring everyone here action with a player follow/decline policy.
- [ ] E10-T03: Show actual online/reconnecting presence, distinct from the existing membership list.
- [ ] E10-T04: Distinguish snapshot sync from live-channel health; report offline/unconfirmed writes honestly.
- [ ] E10-T05: Filter pings/camera targets against scene visibility; never reveal hidden token positions.
- [ ] E10-T06: Test multiple tabs, disconnect/rejoin, scene changes, throttling, and secret locations.

Acceptance: the group can point to the same place and distinguish a disconnected player from an idle member.

### Epic 11 — Tactical spell templates

Status: Planned. Dependencies: E09, E10.

- [ ] E11-T01: Add calibrated circle, cone, line, and cube templates with rotation and readable dimensions.
- [ ] E11-T02: Support private preview and explicit sharing, moving, dismissal, and ownership.
- [ ] E11-T03: Define grid interaction and edge inclusion; leave targeting/adjudication overridable.
- [ ] E11-T04: Provide numeric/keyboard alternatives to pointer gestures and non-color-only presentation.
- [ ] E11-T05: Test geometry at different zooms, units, grid settings, permissions, and scene transitions.

Acceptance: a player can show a spell's area without drawing it freehand or accidentally sharing a private preview.

## Phase 4 — GM preparation and campaign continuity

### Epic 12 — Scene staging and encounter preparation

Status: Planned. Dependencies: E04, E05, E08.

- [ ] E12-T01: Add scene thumbnails and separate Prepare from Show to players.
- [ ] E12-T02: Allow GM editing/inspection of an inactive scene without changing players' active scene.
- [ ] E12-T03: Extend E04's SRD monster browsing with available licensed/custom NPC and monster data and scene-preparation workflows; do not defer the SRD library or basic board placement to this epic.
- [ ] E12-T04: Save encounter groups; drag/drop independent creatures into a prepared scene.
- [ ] E12-T05: Add explicit scene publication and party-transfer behavior with preserved PC resources.
- [ ] E12-T06: Test prepared-scene secrecy, encounter reuse, concurrent GMs if supported, and safe scene transitions.

Acceptance: a GM can prepare the next encounter while players remain on the current scene.

### Epic 13 — Notes, handouts, and session journal

Status: Planned. Dependencies: E12.

- [ ] E13-T01: Add GM-private scene notes with strict server-side access control.
- [ ] E13-T02: Add handouts with explicit audience, publish/revoke controls, and safe asset delivery.
- [ ] E13-T03: Add a lightweight journal for session recaps, clues, and objectives; separate private/shared entries.
- [ ] E13-T04: Link notes and handouts to scenes/encounters; provide search and empty states.
- [ ] E13-T05: Test direct unauthorized reads, realtime secrecy, shared links, revoked access, and unsafe content.

Acceptance: GM preparation stays private until explicitly shared; the party can recover last session's context.

## Phase 5 — Transparent assistance and workspace polish

### Epic 14 — Casting and rest assistance

Status: Planned. Dependencies: E02, E06, E07.

- [ ] E14-T01: Add Cast → choose slot/source → preview → confirm, including Pact Magic and upcasting choices.
- [ ] E14-T02: Spend resources atomically and idempotently; allow manual casting without expenditure when appropriate.
- [ ] E14-T03: Add Apply damage to selected target with a clear preview, authorized target access, and undo.
- [ ] E14-T04: Add Short rest/Long rest previews with source-aware recovery, Hit Dice choices, and manual exclusions.
- [ ] E14-T05: Preserve unsupported/homebrew rules as manual actions with explicit automation limitations.
- [ ] E14-T06: Test double submission, insufficient resources, multiclass casting, concurrent updates, undo, and custom sheets.

Acceptance: resource changes are explicit, understandable, reversible where safe, and never silently inferred.

### Epic 15 — Remembered windows and usability hardening

Status: Planned. Dependencies: E01–E14.

- [ ] E15-T01: Persist sheet/roll window positions, sizes, and dock state per user/workspace.
- [ ] E15-T02: Restore safely after viewport changes; offer Reset layout and prevent offscreen windows.
- [ ] E15-T03: Audit focus restoration, tab order, labels, contrast, reduced motion, and non-color cues.
- [ ] E15-T04: Playtest first join, first encounter, reconnect, and next-session resumption with a GM and players.
- [ ] E15-T05: Benchmark representative maps, fog edits, and eight-player sessions on hosted infrastructure.
- [ ] E15-T06: Update help/operations docs and publish remaining limitations and measured release checks.

Acceptance: the workspace survives a refresh and a real remote group can complete the core flows without coaching.

## Per-epic completion checklist

- Focused behavior tests plus relevant permission, concurrency, and migration tests.
- Formatting, lint, TypeScript, unit/database tests, and production build.
- Relevant browser tests; distinguish local checks from hosted multiplayer verification.
- Update README/status documentation where behavior changes.
- Review the branch diff; exclude unrelated files and credentials.
- Commit, push, create one `ai-coded` PR, record its link, notify owner: ready for review/merge.
- A PR is not “merged” or a hosted check “passed” until actually verified.

## Unresolved Questions

- None blocking E09. Euclidean diagonals; alternate distance rules remain manual/future configuration. Character claims require explicit GM ownership assignment; hidden/other-scene locations remain undisclosed.
- Before E10: forced camera or opt-in follow? Default: opt-in.
- Before E14: which optional rest/house rules? Default: SRD 5.2.1 with manual overrides.

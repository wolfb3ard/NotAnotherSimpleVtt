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

Status: Implemented; preparing review PR. Dependencies: E01 (merged).

- [x] E02-T01: Inventory existing quick-edit and configuration paths; define which changes save immediately.
- [x] E02-T02: Add atomic, authorized resource adjustments with revision checks; preserve generic sheets.
- [x] E02-T03: Persist play-mode HP/counter changes immediately; show Saving, Saved, Failed, and Retry states.
- [x] E02-T04: Preserve explicit Apply/Save for builder and configuration drafts; avoid overwriting unsaved edits.
- [x] E02-T05: Add Damage and Heal actions with previews, temporary HP handling, and manual overrides.
- [x] E02-T06: Test rapid edits, concurrent editors, rollback/retry, revoked access, reload, and reconnect.

Acceptance: routine resource use does not require configuration mode or a whole-sheet save; failures never look saved.

Inventory/save policy: `sheet-editor.tsx` previously drafted generic current/max values; `dnd-sheet.tsx` drafted HP, class counters and grouped Hit Dice; `dnd-tabs.tsx` drafted feature uses and spell-slot Use/Recover actions. Current values and feature uses now save through Play resources/the existing Use/Recover buttons. Field definitions/maxima, names, inventory, biography, preparation, exhaustion and builder configuration remain Apply/Save drafts. Dirty configuration blocks quick updates; pending/unconfirmed resources block configuration and participate in close/switch guards.

Local verification: 327 unit/database/component tests, lint, TypeScript, production build, and six browser auth/smoke tests (Edge) passed. Full formatting passes with `--end-of-line auto`. Revision, permission, atomicity and retry tests run against all migrations in local PGlite; component tests cover rapid edits, rollback, dirty drafts, offline reload, remote renames and reconnect reconciliation. The opt-in multiplayer browser scenario now checks generic quick saves across reload, but was not run for this epic. No hosted migration was applied. Migration: `20261116152232_quick_actor_resources.sql`.

### Epic 03 — Reversible tabletop edits

Status: Planned. Dependencies: E02.

- [ ] E03-T01: Define a bounded, per-user undo history for committed token moves and fog edits.
- [ ] E03-T02: Add revision-checked inverse operations; reject undo that would overwrite another user's later change.
- [ ] E03-T03: Expose Undo with action descriptions and keyboard support outside text inputs.
- [ ] E03-T04: Explain unsupported/expired undo and unconfirmed network operations.
- [ ] E03-T05: Test fog privacy, concurrent movement, retries, permissions, and scene switching.

Acceptance: an accidental move/reveal can be reversed without corrupting newer state. Explain that undo cannot erase information already seen.

## Phase 2 — Encounter-ready play

### Epic 04 — Independent monster instances

Status: Planned. Dependencies: E02.

- [ ] E04-T01: Define reusable monster definitions versus independent encounter actors; keep PC state shared across scenes.
- [ ] E04-T02: Add backward-compatible instance creation with independent HP/resources/conditions and linked appearance.
- [ ] E04-T03: Provide Add N creatures, automatic unique labels, and Duplicate as independent creature.
- [ ] E04-T04: Make shared versus independent state explicit; do not silently reinterpret existing linked tokens.
- [ ] E04-T05: Test six goblins taking independent damage, template changes, deletion, retries, RLS, and reconnect.

Acceptance: adding a group never requires manually creating six sheets; damaging one goblin does not damage the others.

### Epic 05 — Initiative and encounter lifecycle

Status: Planned. Dependencies: E04.

- [ ] E05-T01: Model encounters, participants, initiative, round, and active turn with authorized server operations.
- [ ] E05-T02: Start an encounter from selected tokens; roll initiative through the existing authoritative dice service.
- [ ] E05-T03: Support manual initiative, tie resolution, reorder, add/remove participants, pause/resume, and end.
- [ ] E05-T04: Display turn order; highlight the active token and show a clear Your turn cue.
- [ ] E05-T05: Define player turn-advance permissions; hide secret combatants and GM-only statistics.
- [ ] E05-T06: Test concurrent turn advancement, idempotent rolls, refresh/reconnect, hidden participants, and multiple scenes.

Acceptance: GM and players agree on turn/round; secret enemies do not leak through tracker payloads or events.

### Epic 06 — Conditions, concentration, and death saves

Status: Planned. Dependencies: E05.

- [ ] E06-T01: Add condition markers with source, notes, optional duration, and manual removal.
- [ ] E06-T02: Support start/end-of-turn expiry prompts and overrides; do not silently adjudicate ambiguous rules.
- [ ] E06-T03: Track concentration; prompt for relevant checks when damage is applied.
- [ ] E06-T04: Add death-save controls and explicit recovery/reset actions.
- [ ] E06-T05: Show authorized HP/condition summaries in tracker and token controls.
- [ ] E06-T06: Test durations, defeated/revived creatures, hidden conditions, independent instances, and overrides.

Acceptance: combat bookkeeping is visible and editable without implying that every conditional rule is automated.

### Epic 07 — Token quick actions

Status: Planned. Dependencies: E05, E06.

- [ ] E07-T01: Separate token selection from opening its sheet; support keyboard-accessible equivalent controls.
- [ ] E07-T02: Add Sheet, Attack, Damage/heal, Conditions, and Initiative actions appropriate to permissions.
- [ ] E07-T03: Add GM Hide/reveal, Duplicate, and Assign control actions.
- [ ] E07-T04: Use immediate sheet rolls for simple actions and the existing panel for advanced expressions.
- [ ] E07-T05: Explain blocked actions without exposing restricted sheet data.
- [ ] E07-T06: Test owners, controllers, view-only members, GM preview, private rolls, and missing sheets.

Acceptance: an ordinary attack and HP adjustment can be completed from a selected token without panel hopping.

## Phase 3 — Joining and moving around

### Epic 08 — Guided first session and sensible placement

Status: Planned. Dependencies: E01, E04.

- [ ] E08-T01: Add role-specific, dismissible/resumable checklists derived from actual campaign state.
- [ ] E08-T02: Guide GMs through invitations, map upload, scale, party placement, and initial reveal.
- [ ] E08-T03: Guide players through joining, creating/claiming a character, portrait, placement, and a test roll.
- [ ] E08-T04: Make claiming a character GM-authorized; do not infer ownership from a name.
- [ ] E08-T05: Add click-to-place and a GM-defined party spawn point instead of top-left placement.
- [ ] E08-T06: Add Find my character; handle multiple tokens, no token, other scenes, and concealed locations safely.
- [ ] E08-T07: Test new/existing games, interrupted onboarding, ownership transfer, fog, and placement retries.

Acceptance: a new group can reach a visible, controllable party on a calibrated scene without reading the README.

### Epic 09 — Navigation, grid, and movement feedback

Status: Planned. Dependencies: E03, E08.

- [ ] E09-T01: Add configurable grid overlay, size/origin calibration, and optional snapping; keep free movement.
- [ ] E09-T02: Show measured movement distance while dragging using scene scale and an explicit distance convention.
- [ ] E09-T03: Add Space-drag pan without intercepting typing or breaking token dragging.
- [ ] E09-T04: Make Fit map and Center on my token discoverable; document shortcuts in an in-room help panel.
- [ ] E09-T05: Remember viewport per user/game/scene; clamp restored views and offer reset.
- [ ] E09-T06: Test zoom/scale, grid offsets, map bounds, fog-safe centering, keyboard inputs, and reconnect.

Acceptance: players can locate their tokens and move a known distance without guessing pixel scale.

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
- [ ] E12-T03: Add searchable/filterable NPC and monster browsing using available licensed/custom data.
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

- None blocking E01.
- Before E05: GM-only turn advance, or active player too? Default: GM only.
- Before E09: diagonal distance rule? Default: Euclidean; configurable later.
- Before E10: forced camera or opt-in follow? Default: opt-in.
- Before E14: which optional rest/house rules? Default: SRD 5.2.1 with manual overrides.

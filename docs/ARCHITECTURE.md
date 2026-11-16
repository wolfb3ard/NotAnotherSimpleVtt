# Architecture

## Authorization

Supabase Auth identifies users. A membership is keyed by `(game_id, user_id)`; roles are local to that game. `create_game` creates the game and GM membership atomically. Players join through hashed, expiring invitation tokens. Duplicate acceptance does not duplicate membership or change an existing role.

All gameplay tables enable row-level security. Authenticated clients have SELECT access only; writes use `create_game`, `accept_invite`, and `mutate_game`. These security-definer functions pin their search path, use `auth.uid()`, and check membership/ownership per operation. The room row is locked during mutations to serialize conflicting commands. Sheets, scenes, and tokens also carry revision numbers.

The service role is used only on the server for validated image handling and `record_roll`. Browser roles cannot execute `record_roll` or directly insert roll results. The server resolves sheet fields and generates cryptographic dice outcomes; the RPC rechecks membership, character control, and enabled dice before inserting. A client-generated UUID makes retries idempotent.

Sheet permissions are independent of token visibility/control. Owners and the GM can edit their sheets; GM grants can allow others to view/edit. Assigning a token controller does not silently grant access to its sheet. Grant sheet access separately when the controller needs saved sheet rolls.

## Synchronization

Mutations increment a room invalidation revision in the same transaction. Supabase Realtime publishes only that revision, not private rolls, sheets, or token coordinates. Clients fetch fresh RLS-filtered snapshots after invalidation. Replacing the snapshot removes newly concealed or revoked rows; relying only on filtered UPDATE events would leave stale rows on clients that could no longer read them.

Invalidations are coalesced for 120 ms. Foreground clients reconcile every 15 seconds as a fallback and when returning online/to the tab. A token drag previews locally and commits once on drop with its starting revision. Concurrent edits reject the stale move instead of overwriting another player's update.

`tabletop_command` serializes move/fog/undo operations on the same game lock and delegates writes to `mutate_game` for existing authorization, bounds and fog checks. Private `tabletop_history` stores server-captured inverses and idempotency receipts, with no client table access or Realtime publication. History responses include only action IDs and generic descriptions for currently authorized targets in the active scene—never inverse coordinates, fog geometry, or labels. Each user/game retains at most 20 receipts, lazily expiring after 24 hours. Inverses check full target revisions; undoing consecutive own actions rebases only the exact previous revision chain. Other intervening changes break that chain.

The room shares one tabletop operation queue across drags, painted fog and full-scene fog controls. Pending requests block further reversible edits; uncertain attempts retain their original UUID/payload in user/game/scene-scoped session storage for acknowledgement retries after reload. Focus/reconnect reloads server history. Dismissing an attempt explicitly does not reverse it. Existing clients and unsupported mutations remain valid and advance revisions, safely blocking incompatible undo.

The initial design favors simple authorization over fine-grained synchronization. Snapshot size and database/realtime usage should be measured before increasing room size or movement frequency. Snapshots use Supabase's default row cap; the first release targets small rooms, not thousands of actors/scenes per room.

## Private image delivery and fog

The private `tabletop` bucket has no browser upload/download policies. Server uploads validate membership, role, file bytes, dimensions, and image type, then normalize to metadata-free WebP.

Original backgrounds are GM-only. Player scene requests authorize the active scene, load its current visibility revision, and render a sanitized bitmap. Concealed RGB values are replaced with a solid color, not retained underneath transparent pixels. Ordered reveal/conceal rectangles define the mask; partially covered edge pixels stay concealed.

Sanitized derivatives are cached privately by game/scene/revision. Every request reauthorizes against the current scene; user-supplied revision query strings never select an old server revision. Responses use `private, no-store`. No raw storage paths or signed URLs are used as a substitute for authorization.

Token visibility is determined independently by the GM hidden flag and whether the token center is inside revealed terrain on the active scene. GMs can see all scene tokens. Concealing content cannot erase imagery or information a participant already saw or saved.

## Sheets and dice

Resource writes retain the existing authorized, revision-checked `adjust_actor_resources` path. `QuickResources` provides compact controls in `TokenQuickActions`; sheet editors mount only its save controller/pending-failure feedback for their existing Use/Recover buttons. The room coordinates dirty-sheet and resource-busy guards across both windows. Cards derive actor data exclusively from the authorized snapshot, are keyed by token/actor, and disappear when their token leaves the active scene. Controller rights alone never become sheet-edit rights.

Versioned sheets use JSON documents with stable section/field/ability UUIDs. Database constraints validate documents even if clients bypass the Next.js forms. Creating sheets from templates makes independent copies. Only a template creator can copy that template between games they belong to.

`create_encounter_creatures` is a GM-only, game-locked transaction that creates 1–20 independent actor/token pairs, all GM-owned and initially hidden. Private `(game,user,operation)` receipts deduplicate complete requests even after reload/source deletion; current membership/GM authorization is checked before receipt reads. Source actor revisions reject stale copies. Existing token placement remains linked, including cross-scene PCs. New `encounter_instance` metadata never reinterprets old actors/tokens.

SRD definitions are immutable checked-in records imported from all 336 PDF stat-block headings, cross-checked against an independent creature-type/AC inventory. Creation resolves source content server-side. Sheets retain complete source text in bounded generic fields; controls use printed monster modifiers, not PC calculations. The lazily loaded monster play view exposes full source/spell text, rolls and independent atomic resource controls. Unsupported/summoner-dependent rules remain explicit manual configuration. Ordinary sheets only import small marker helpers, not the full monster catalog.

Custom NPC/enemy definitions use separate actors; instance sheets never synchronize back to them. `appearance_source_id` propagates only image/ring changes until an explicit instance appearance save detaches it. `definition_actor_id` records provenance; foreign keys clear only the source IDs on deletion without deleting descendants. Appearance updates increment appearance/token revisions, not sheet revisions. No source grants are copied. Existing sheet/token RLS and private-roll delivery remain the authorization boundary; saving a reusable template explicitly shares that sheet with campaign members.

Dice expressions use a bounded recursive-descent parser, not `eval`. Arithmetic honors parentheses and normal operator precedence; division retains decimals. Outcomes record original and resolved expressions, field values, individual dice, kept/discarded results, and totals. Later sheet changes never rewrite historical rolls.

3D dice are client-rendered with React Three Fiber. Each numbered face has a matching landing orientation; the visual tween lands on the already persisted server value. Nonstandard dice use an anonymous `?`-faced d6, never an invented number. Results remain in accessible text history even without WebGL. At most eight real dice render per overlay, with a textual count for the rest.

The public `roll_cues` table contains only roll ID, game ID, private flag, and timestamp. Public rolls and private **player** rolls insert cues in the same transaction as the result. Private GM rolls create no cue. All room members can read cues, but `rolls` RLS still restricts private results. Unauthorized viewers see only one anonymous masked die per private-player cue, independent of actual expression, die count, or author. Realtime publishes room invalidation revisions and these sanitized cues, never roll payloads. Only the author sees their private GM animation locally after a confirmed server roll. Per-user dice styles have bounded server validation and game-membership-scoped reads; masked cues always use the neutral default style to avoid identifying the roller.

## Runtime

Next.js server actions and route handlers run on Vercel. Supabase provides durable services; Vercel does not host a persistent WebSocket server. `src/proxy.ts` refreshes auth cookies; every data route/action still performs its own authorization.

No infrastructure credentials are required to build or run the unit/database tests. Hosted authentication, email, storage, realtime delivery, and nine-person performance need validation against a configured Supabase project before release.

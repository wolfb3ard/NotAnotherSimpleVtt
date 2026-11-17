# Not Another Simple Vtt

**Not Another Simple Vtt** is a desktop-browser, system-agnostic virtual tabletop. Next.js runs on Vercel; Supabase provides authentication, Postgres, private image storage, and realtime room updates.

## Included

- Google sign-in through Supabase, multiple games, game-scoped GM/player roles, and expiring/revocable invitations.
- Custom character/NPC/enemy sheets, sections, text/numeric/resource fields, abilities, sheet permissions, and reusable templates.
- Complete SRD 5.2.1 monster library, source-faithful stat blocks, and independent encounter creatures with usable attacks, spells and resources.
- Scene-scoped initiative and encounter tracking, GM-controlled turns/rounds, private initiative rolls and permission-filtered player turn cues.
- Private actor conditions, turn-expiry reviews, concentration reminders and manual death-save/recovery controls.
- Resumable first-session guides, GM-authorized character assignment, click/numeric token placement, private party spawn points and fog-safe Find my character.
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
- **Token quick actions** adjusts current HP, class counters, Pact slots, and grouped Hit Dice without adding another section to the character sheet. Expand **Class resources, grouped Hit Dice & spellcasting** on the sheet to inspect statistics or edit configuration. The Spell tab offers class/feat/species-specific attack rolls as well as the configurable default. Alert's proficiency bonus applies to initiative without increasing unrelated checks.
- Builder decisions are optional versioned sheet data, validated by both application and database. Apply `supabase/migrations/202611150004_srd_builder.sql` after earlier migrations. Old manual sheets and templates remain valid. New source data/migrations are checked in; normal application startup does not fetch an external rules API.

To reproduce the import, install Python and PyMuPDF (`python -m pip install PyMuPDF`), provide the source PDF, then run `npm run srd:import`. The source fingerprint and attribution are in `src/lib/srd-data/manifest.json`. After changing builder rules, run `npm run srd:migration` and the application/database tests. Generation never applies hosted changes; review generated migrations before merge, when the production workflow applies them.

### GM monsters and independent creatures

- **Party → SRD monsters · Add independent creatures** opens all **336 printed stat blocks**, including six creatures in spell/item sections. Search by name/type, filter CR, inspect the full source, then add **1–20 creatures** to the active board. No external rules API or alternate SRD edition is used.
- Each creature gets its own GM-owned sheet, HP, temporary HP, conditions/notes and use counters. Tokens start **hidden** near the board center; reveal them explicitly. Sheet grants are separate from token visibility/control. Opening an SRD monster sheet as GM defaults the shared roll audience to **Only me**; you can explicitly select Everyone.
- Monster sheets use the player sheet's compact combat header and keyboard-accessible tabs: **Actions**, **Spell**, **Abilities**, **Features & Traits**, **Resources**, and **Notes & Source**. Attack, damage, critical and recharge rolls are grouped under one action; full rules/source are collapsed. A single **Sheet roll mode** applies to d20 rolls only. HP/temporary HP and use counters save through the existing quick-resource queue; configuration still uses **Customize monster sheet**. Speed, defenses, senses and creature type marked **source** are printed reference values, not recalculated encounter statistics.
- Use the token's **Open character sheet** to roll printed attacks, individual damage components, checks/saves, recharge or spells. **Declare** records a manual action/cast in roll history with a zero total (no invented dice). Spell entries show full rules, monster-specific casting restrictions, printed save DCs and applicable spell attacks/dice. Casting and resource expenditure are separate explicit actions, like existing player spell sheets; Spend/Recover use controls save immediately.
- **Portrait & token appearance** changes images/rings through the existing image uploader. **Customize monster sheet** edits statistics, expressions, notes and resource maxima; **Save sheet** commits the draft. The complete, unmodified published stat block remains available separately from encounter edits.
- An existing NPC/enemy sheet can be a reusable definition. Choose **Existing NPC / enemy sheet**, or right-click its token → **Duplicate as independent creature**. Copies use the source's **current** sheet state, including spent resources; grants are not copied. Definition sheet edits never change existing instances. Appearance follows the definition until explicitly overridden on an instance; deleting a definition preserves independent creatures.
- Map-toolbar **Place character** places a **linked token**, not a new creature. Tokens of the same actor continue sharing a sheet; PCs stay shared across scenes. No existing tokens are silently converted.
- Creation is atomic and GM-only. Lost responses retain the operation ID for safe retry, including same-tab reload when session storage is available. **Dismiss unconfirmed creation** does not undo creation; check the board before adding another group.
- Multiattack sequencing, targeting, save outcomes, conditions, resistance, concentration, legendary/lair variants, rest recovery and complex spell scaling remain manual. Simple explicitly printed higher-level spell damage scaling is supported; no caster class/level is inferred. Summoner/size-dependent creatures retain their complete formulas; configure their unresolved HP/AC/expressions before play (unresolved HP starts at 0). Generic resource fields can represent custom spell-slot pools; SRD monster casting uses its printed at-will/per-day rules, not PC slot progression.
- Reproduce/verify with `npm run srd:monsters` / `npm run srd:monsters -- --check`. `src/lib/srd-data/monsters-manifest.json` records the source hash, count and independent type/AC inventory. Raw source text is retained with PDF pages; VTT controls/formatting are adaptations under the attribution above.
- Apply `supabase/migrations/20261116202045_encounter_creatures.sql` after earlier migrations before deployment. No hosted migration is applied by the importer or application startup.

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

### Token quick actions and quick health updates

- **Click a token** to select it and open its compact, non-modal **Quick actions** card—not its sheet. Right-click or the keyboard-accessible **Token quick actions** toolbar chooser opens the same card; **Open character sheet** opens the sheet explicitly. Drag the card header (or focus its move handle and use arrow keys); close with × or Escape. GM **Player view** closes the card and disables token actions; leaving preview restores access.
- **Attack / sheet rolls** uses saved sheet expressions immediately, with Normal/Advantage/Disadvantage for leading d20 rolls. D&D weapons expose attack, damage and critical rolls; generic/monster sheets retain saved/customized abilities and rules text. Only GM/owner/controllers with sheet access can roll; view/edit grants alone do not grant control. The current shared roll audience is displayed; opening an SRD monster's quick actions as GM defaults it to private, just like its sheet. **Advanced roll in Dice** loads the selected expression into the existing Dice panel without rolling. Hits, targeting, spell expenditure and conditional rules remain manual.
- GM **Initiative** can start an encounter with this token, add it, reroll it, or set a manual total. Automatic initiative is private and authoritative; failed/unconfirmed attempts retain exact retry IDs across same-tab reload. Players see a GM-only explanation, not encounter mutation controls. GM **token controls** provide Hide/Reveal, Assign control and size; these edits remain revision-checked and not undoable. **Duplicate as independent creature** is available for NPC/enemy actors, not PCs; new creatures start hidden and do not inherit sheet grants.
- HP and temporary HP appear first, with **Damage / Heal** immediately available. Other counters, spell/Pact slots, grouped Hit Dice and feature uses are collapsed under **More resources**. Generic resource fields work too. Current values save immediately; there is no Play resources section on the character sheet. Existing sheet **Use/Recover** buttons still save immediately, with inline feedback only when pending/failed.
- GM/owner/edit grants determine resource editing; token control alone does not grant it. Read-only sheets stay read-only. Tokens without sheet access show no sheet values. Cards disappear when their token leaves the authorized active-scene snapshot.
- **Resources: Saving… / Saved / Failed** describes confirmation, not just local edits. Rapid current-value edits queue in order. Failures restore the last confirmed display and retain **Retry resource update** with the same operation ID, preventing duplicate application after a lost response.
- **Reload resources** fetches a fresh authorized snapshot and discards unconfirmed queued intent; an offline reload stays Failed. After a concurrent edit, reload/review values rather than replaying stale intent. Ordinary refresh/reconnect synchronizes clean sheets; configuration drafts retain their conflict warning. Pending/failed updates participate in the existing close/switch warning.
- **Damage / Heal** previews HP and temporary HP, then requires confirmation. Damage normally consumes temporary HP first; turn that off to override. Healing stops at maximum HP and does not change temporary HP. Direct resource inputs remain manual overrides. Resistance, vulnerability, concentration, death saves, and other conditional rules are not automated. Temporary HP is an optional resource added to old D&D sheets only when used; entering it replaces the current value, not stacks it.
- Names, field definitions/maxima, generic numeric stats, exhaustion, inventory, biography, spell preparation, feature configuration, and builder decisions remain explicit drafts: **Apply** in the builder, then **Save sheet**. Save/reload dirty configuration before using that actor's quick actions. The same sheet's configuration controls lock while a card resource write is pending/unconfirmed; closing/switching an unconfirmed card warns that it does not cancel/reverse a write. Draft controls also lock during whole-sheet saves.
- Apply `supabase/migrations/20261116152232_quick_actor_resources.sql` after earlier migrations before deploying. Its RPC authorizes current GM/owner/edit grants, serializes with room permission changes, revision-checks atomic multi-resource updates, and privately stores per-user operation receipts. Existing sheets/templates remain valid. Application startup never migrates databases; the production workflow below applies pending migrations.

## Initiative and encounters

- Open **Encounter** in the room sidebar. The GM selects board tokens with checkboxes and starts an encounter. Leave a total blank to roll saved initiative; enter a manual total to override it. PCs use their computed initiative, SRD creatures use their printed initiative, and generic sheets can define an **Initiative** ability or numeric modifier field. Missing rules require a manual total rather than an invented modifier.
- Automatic rolls reuse the server dice engine and saved numeric fields. An entire batch and its turn order commit together, with sheet/token revisions checked again. Rolls are recorded **privately as GM**, without public cues or per-creature animation replay. Published tracker entries contain only visible token labels and initiative totals, never expressions, modifiers, HP or sheets.
- Initial order is descending initiative; ties keep selection order. Set a manual score, reroll an individual participant, add/remove participants, or use **↑ / ↓** to resolve ties/override order. Adding, changing scores and rerolling sort descending again but preserve the current token/round; ties preserve their existing relative order. Reordering alone preserves scores and the current token.
- **Next turn** is GM-only, including when a player owns/controls the active creature. It advances once and increments the round on wrap. **Pause / Resume** preserves the current token and round. Removing the current participant selects the next survivor, incrementing the round on wrap; an empty encounter pauses until participants are added and the GM resumes. Deleting a token/actor reconciles its participation too.
- The active token receives a dashed outline and a textual **current turn** marker. A persistent **Your turn** cue appears for the active visible token's player owner/controller, even outside Encounter. Paused/ended encounters do not announce Your turn. The map's player preview omits hidden turn markers.
- Players receive only currently visible participants in the active scene: no hidden/fogged IDs, labels, order gaps, private revision, total count or hidden-turn placeholder. A non-visible current turn displays only **Waiting for GM**. Token visibility/control never grants sheet access; sheet links follow existing grants. Hiding again cannot erase information already seen.
- One live encounter per scene; switching scenes preserves each encounter independently and does not advance it. Only the active scene can be mutated/read through the tracker API. **End encounter** stops advancement but does not reset resources, conditions, sheets or tokens. Start a new encounter explicitly afterward. Turn undo/backtracking and automatic turn/resource/condition rules are not implemented.
- Encounter updates are server-confirmed, revision-checked and idempotent. Failed/unconfirmed requests block further changes and retain an exact retry across same-tab reload when session storage is available. **Retry encounter change** acknowledges the same operation, not another turn/roll. For stale requests, **Dismiss encounter attempt**, refresh/review, then issue a new change; dismissal never reverses a committed operation.
- Apply `supabase/migrations/20261116210025_encounter_initiative.sql` after earlier migrations before deployment. Tables/receipts have no browser read/write grants; scoped RPCs provide the filtered projection and GM operations. No hosted migration is applied by application startup.

## Conditions, concentration and death saves

- Open token quick actions (right-click, or the keyboard token chooser), then **Conditions & survival**. GM, owner and edit grantees can change bookkeeping; view grantees can read it. Token control alone grants neither sheet access nor editing. HP/condition summaries in Encounter only appear for actors whose sheets you can read; visible enemies do not expose private statistics, marker sources or notes.
- Add any named condition/custom marker, its source and notes. **Edit**, **Remove**, and **Keep until manual removal** are explicit overrides. Up to 30 markers per actor; independent encounter creatures remain independent, while linked placements/PCs share actor bookkeeping across scenes.
- Optional expiry is an exact round plus start/end of this actor's turn in the current encounter. Advancing turns flags **Expiry review** without removing anything or rolling a save. Pausing, refresh, reconnect and ending an encounter do not discard markers. Another creature's turn, time-based durations, saving throws, concentration-linked effects and ambiguous timing remain manual. Multiple linked tokens in one encounter each count as that actor's turn; use manual timing if that is not intended.
- **Start concentration** records a source and notes. Committed decreases to D&D/SRD-monster HP or temporary HP generate persistent Constitution-save reminders, including direct resource/configuration edits. Suggested 2024 DC is half recorded loss rounded down, minimum 10, maximum 30. Roll from the sheet, optionally override the reminder DC, then record **Check passed / ignore reminder** or **Check failed — end concentration**. No automatic end at 0 HP; review incapacitation explicitly.
- Concentration prompts infer _recorded loss_, not damage rules: resistance, overkill beyond remaining HP, simultaneous healing, separate sources in one update and damage without a resource decrease require manual adjudication. At 100 outstanding reminders, further losses aggregate into the last reminder; resolve individual sources manually. Healing and increasing temporary HP never create a reminder. Ending concentration does not remove related conditions automatically.
- **Roll death save (d20)** uses the existing authoritative dice service and current roll audience. Record successes/failures manually (including two failures for natural 1). Natural 20: explicitly apply 1 HP, then reset. Counters/threshold summaries do not heal, kill, revive or reset automatically. **Stabilize** resets counters and marks stable; **Recovered / revived** clears counters/stable without changing HP, concentration or conditions. Use health/condition controls for those changes.
- Combat writes have their own revisions, game-serialized authorization and durable idempotency receipts. Failed/unconfirmed operations retain the exact retry across same-tab reload when storage is available, block further quick writes, and participate in existing dirty/pending close guards. Dismissal does not reverse a committed change. Review the refreshed state before editing after stale/revoked access.
- Apply `supabase/migrations/20261117134351_combat_bookkeeping.sql` after earlier migrations before deployment. Existing actor RLS protects combat data; receipt storage is private. No hosted migration is applied automatically.

## Persistent token appearance

- Open any sheet → **Token appearance**. Owners and GMs can upload a PNG/JPEG/WebP portrait (up to 4 MB), choose one of six ring presets, and **Save appearance**. Portraits are center-cropped, not stretched. This save is separate from sheet-stat edits.
- Map-toolbar **Place character** uses the saved appearance in the active scene. Players can place their own characters; GMs can place any actor, including multiple linked placements. Player placement retries do not create duplicates.
- Appearance changes update existing placements in every scene. Linked tokens share the same live sheet: HP, resources, and other stats are not copied or reset on ordinary placement or scene changes. Use **SRD monsters** or **Duplicate as independent creature** for separate monsters rather than placing another linked token.
- **Click to place** chooses a map position; its popover also accepts pixel X/Y for keyboard use. **Place at party spawn** uses the GM’s per-scene spawn, falling back to the map center. Existing placements are unchanged. Appearance remains managed on the sheet.

### First-session guide and party placement

- The sidebar guide derives completion from actual campaign state, not checked boxes. GM steps cover invitations, active map, calibration, spawn, assigned/controlled characters and initial reveal. Player steps cover membership, owned character, portrait, visible placement and an authenticated test roll. Existing campaigns use their current state; optional portrait/setup steps never block play.
- **Dismiss guide** / **Resume first-session guide** remembers your preference per user/game/role in this browser when local storage is available. Progress is re-derived after reconnect/reload; test-roll completion survives the recent-roll window.
- Players can create their own characters or ask the GM to assign an existing sheet. The GM opens **Manage sheet access → Sheet owner** to approve that claim; names and edit grants never imply ownership. This is a verbal/out-of-app request, not a pending-claim inbox. Existing ownership-transfer and draft guards remain.
- GM **Set party spawn** accepts a map click or numeric coordinates. Its marker/coordinates are GM-only and omitted from player snapshots. Reveal that area before inviting players to place. Player placement requires revealed space; absent, off-scene or concealed tokens all receive the same safe guidance, never coordinates or scene names.
- **Find my character** centers only a currently visible owned-character/controlled token in the active scene. Multiple tokens have an explicit chooser; no visible token shows guidance to ask the GM. It does not move tokens, activate another scene, open a sheet, or reveal fog. Placement/finding/spawn controls are disabled in GM player preview.
- Placements are scene-revision checked, server-authorized and idempotent. Uncertain requests retain the exact operation through same-tab reload when session storage is available. **Retry placement** cannot create another token; dismissal does not undo a committed placement. GMs can intentionally place additional linked tokens with new operations. Placement/spawn changes are not in move/fog Undo.
- Apply `supabase/migrations/20261117143225_guided_first_session.sql` after earlier migrations. Existing sheets and scenes remain valid. Pre-existing non-default scales count as calibrated; use **Set scale** to explicitly confirm a default-valued scale. No hosted migration is applied during implementation.

### Navigation, grid and movement

- **Fit map / Reset view** is in the top toolbar; **Fit map** also remains beside zoom controls. **Find my character** centers only an explicitly chosen, visible owned/controlled token, never hidden or off-scene locations.
- Views are browser-local per user/game/scene, restored across refresh/scene switches and clamped after resizing. Storage is optional; **Reset view** fits the map again. Camera changes do not move tokens or enter Undo history.
- **Map help & shortcuts** explains controls inside the room. Drag empty map in Move mode, or hold **Space before dragging** to pan in any tool, including over tokens. Text fields, buttons, editable content and in-progress token/drawing gestures are not intercepted; releasing Space restores the tool after the pan ends.
- Scroll zooms around the pointer; zoom buttons use viewport center. While dragging a controlled token, a zoom-independent label and line show calibrated **Euclidean straight-line displacement**, including diagonals. This is not travelled path, speed, terrain, wall or rules adjudication. Uncalibrated scenes explicitly show an estimate.
- GM **Grid settings** → configure shared square-cell size/origin in map pixels → **Apply grid**. This aligns the overlay, not the distance scale; use **Calibrate → Set scale** for actual scene units. Existing maps default to grid off. Grid changes are revision-checked, GM-authorized and idempotent; uncertain requests offer exact Retry/Dismiss and survive same-tab reload. Grid configuration is not undoable.
- **Snap to grid** is an optional local toggle, off by default. Movement snaps token centers to cell centers with the configured origin, clamps within map bounds, and still uses the existing authoritative fog/permission/revision checks and Undo. Turn snapping off for free movement; placement remains explicit, unsnapped map coordinates.
- Apply `supabase/migrations/20261117145441_navigation_grid.sql` after earlier migrations. No hosted migration applied during implementation.

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

1. Verify all deployment credentials; install locked application dependencies and a pinned Vercel CLI; verify access to the configured Vercel team/project with `vercel pull`, using `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. Invalid Vercel access fails before database changes. Avoid `vercel link` here: its user lookup can fail for the CI credentials even when project access works.
2. Link production Supabase, show pending migrations with `db push --dry-run`, then apply them with `db push`.
3. Submit that same checked-out commit with `vercel deploy --prod --yes`. Vercel builds it remotely with the real production environment and publishes only after a successful build.

The access check downloads configuration under `.vercel`, which is excluded from deployment uploads. Do not use that downloaded environment for a local `vercel build` → `--prebuilt`: Secret variables are downloaded as `[SENSITIVE]` placeholders. Next.js inlines `NEXT_PUBLIC_*` values at build time, so a placeholder Supabase URL breaks every request in middleware. The remote build uses the actual hosted environment instead.

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

This action deploys **versioned database migrations** and the **production application**, in that order. It does not configure hosted Auth URLs/SMTP, provision projects, deploy Edge Functions, or manage Vercel environment-variable values. Keep `NEXT_PUBLIC_SITE_URL` set to the stable public production origin. PR previews must use an isolated database/project, not production.

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

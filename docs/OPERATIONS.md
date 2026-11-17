# Operations

## Before inviting a group

- Apply all migrations and confirm the private `tabletop` bucket exists.
- Confirm `room_events` is included in the Realtime publication and that other gameplay tables are not published by these migrations.
- Set site URLs, callback allowlists, Google provider credentials, and environment variables for the correct environment. Test Google sign-in in a signed-out browser and from an invitation. Discord's sign-in button is currently hidden.
- In separate GM/player browsers, create/join a room, upload a scene, reveal part of it, add/move a token, calibrate/measure, save a sheet, and roll publicly/privately.
- Check player requests cannot fetch raw backgrounds, hidden tokens, restricted sheets, or GM-private rolls.
- Apply `20261116161714_reversible_tabletop.sql` before the Epic 03 app. Verify move/fog Undo, reload/retry acknowledgement, concurrent-change rejection, and loss of control. Inverse history must have no client table grants or Realtime publication. Undo does not erase information already seen.
- Disconnect/reconnect a player and verify persisted state returns. Revoke a sheet grant and confirm it disappears from that player's view.
- Load-test a GM and eight players, including large supported images and repeated fog edits. Measure image processing duration, request latency, reconnect behavior, and service quota usage.

## Low-cost operation

Start with free-tier projects where suitable. Monitor Supabase database size, storage, egress, realtime messages/connections, and auth email limits, plus Vercel function invocations, compute, and image-route durations. Consult current provider pricing rather than assuming free-tier quotas are permanent. Supabase may pause inactive free projects.

Images are normalized on upload. Fog derivatives are shared between viewers of the same scene revision; oversized derivatives are served without caching if they exceed the bucket's 6 MiB object limit. Large/complex masks can still be expensive, so image and rectangle limits must be revisited after hosted measurements.

The application does not yet schedule automatic asset cleanup. Periodically remove obsolete `masked/<game>/<scene>/<revision>.webp` derivatives, keeping each scene's current revision. Remove orphan originals that are not referenced by any scene/token after verifying the `assets` records. Failed scene/token creation may leave an uploaded asset for later cleanup.

Roll history is retained in Postgres; the UI queries the newest 50 authorized entries. Export before implementing any retention deletion. Token drags commit once on drop. Undo history is bounded to 20 receipts per user/game and expires lazily after 24 hours on that user's next tabletop request; there is no scheduled cleanup.

## Recovery and backup

- Keep migration files in source control. Review production migrations and back up data before applying schema changes.
- Supabase database backups do not replace Storage object backups. Export database content and copy private image objects separately.
- Use Supabase's backup/restore tools where the selected plan provides them. Otherwise schedule database dumps with the CLI or `pg_dump` and independently archive Storage objects.
- Test restore into a separate project. Reconfigure keys, authentication redirects, OAuth providers, private bucket policies, and Realtime publication as necessary.
- To roll back the app, redeploy a known Vercel deployment. Schema changes need a compatible forward migration or a deliberate database restore, not an automatic destructive rollback.
- Application logs should report failed operations without copying service credentials or private sheet/roll payloads.

## Troubleshooting

| Symptom                         | Check                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Setup page instead of dashboard | Public Supabase environment variables; rebuild after changing them                                                      |
| OAuth sign-in fails             | Enabled provider, client credentials, provider's Supabase callback, app callback allowlist, same browser/domain         |
| Google blocks a user            | OAuth audience, publishing status, and test-user list in Google Auth Platform                                           |
| Sign-in opens Vercel login      | Use the public production domain; Supabase site URL and callback allowlist must not point to a protected deployment URL |
| Player sees a dark map          | New scenes start concealed; use Reveal as GM                                                                            |
| Token is absent                 | Active scene, explicit hidden flag, fog at token center                                                                 |
| Player cannot use a saved roll  | Actor control and independent sheet access; save sheet edits first                                                      |
| “Changed” conflict              | Reload the sheet or retry the action using current room state                                                           |
| Reconnecting status             | Supabase project availability, Realtime publication, session validity                                                   |
| Image upload fails              | Server service key, bucket, file type/size/dimensions                                                                   |
| Image processing is slow        | Map complexity/dimensions, revision-cache misses, Vercel function duration                                              |

## Git and deployment workflow

Work on feature branches. CI runs formatting, lint, TypeScript, unit/database tests, build, and infrastructure-free browser smoke tests. Run the opt-in multiplayer suite against a separate Supabase test project before production rollout. Review the PR and merge before selecting the production deployment.

The `Deploy production` workflow runs after successful `Checks` on a same-repository `main` push. It checks out the exact validated SHA, skips stale checked commits, validates Vercel access, applies Supabase migrations, then builds and deploys the production application with Vercel's prebuilt-output flow. All stages share one concurrency lock; failures prevent later stages. `vercel.json` disables independent Git production deploys from `main` while preserving branch previews. Pull requests never receive production credentials.

Configure all production environment secrets and the project-ref variable as described in [README.md](../README.md#ordered-production-releases) **before merging** the deployment workflow. Missing Vercel credentials stop before database changes and leave the existing application live. Keep the public `NEXT_PUBLIC_SITE_URL` set in Vercel production settings.

If migrations fail, fix the cause before rerunning deployment. Never use `migration repair` to hide a failure without verifying the actual schema. If build/deploy fails after migrations pass, database changes remain applied; rerun the failed workflow if its SHA is still current, otherwise merge a fix and wait for its checks. Backward-compatible migrations remain mandatory while the previous application is serving traffic. Dashboard/manual CLI production deploys and app rollbacks bypass GitHub's migration gate; restrict access and confirm schema compatibility before using them.

## Epic 15 release verification

No migration is needed. Layouts are local to the browser profile; if site storage is blocked they work only until reload. A smaller viewport fits the windows without overwriting the preferred larger layout. Sheet restoration requires the actor to be present in the authorized snapshot.

**Remote playtest (pending):** On staging, give a GM and players only an invitation and the in-app guide. Observe first join and character assignment, one encounter with a public and private roll, one player disconnecting/rejoining, and a later visit with a resized sheet and detached Rolls. Repeat with keyboard only, reduced motion and a smaller viewport. Record completion time, coaching requests, focus losses, missing state and unauthorized disclosures. Mark uncoached acceptance only if every core flow completes unaided.

**Hosted benchmark (pending):** Use an isolated staging game with a GM and eight simultaneous players. Record deployment SHA, region, network/browser and map dimensions/bytes. Test a typical and a large campaign map: measure cold and warm time to visible map; make 20 spaced reveal/conceal edits per map and measure commit-to-visible latency on players. Record median, p95, worst latency, errors and reconnect convergence; check that hidden pixels stay hidden. Archive anonymized results before release. The opt-in `e2e/multiplayer.spec.ts` is a functional regression check, not a substitute for these measurements.

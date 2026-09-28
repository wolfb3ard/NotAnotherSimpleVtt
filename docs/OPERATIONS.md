# Operations

## Before inviting a group

- Apply all migrations and confirm the private `tabletop` bucket exists.
- Confirm `room_events` is included in the Realtime publication and that other gameplay tables are not published by these migrations.
- Set site URLs, callback allowlists, SMTP, and environment variables for the correct environment.
- In separate GM/player browsers, create/join a room, upload a scene, reveal part of it, add/move a token, calibrate/measure, save a sheet, and roll publicly/privately.
- Check player requests cannot fetch raw backgrounds, hidden tokens, restricted sheets, or GM-private rolls.
- Disconnect/reconnect a player and verify persisted state returns. Revoke a sheet grant and confirm it disappears from that player's view.
- Load-test a GM and eight players, including large supported images and repeated fog edits. Measure image processing duration, request latency, reconnect behavior, and service quota usage.

## Low-cost operation

Start with free-tier projects where suitable. Monitor Supabase database size, storage, egress, realtime messages/connections, and auth email limits, plus Vercel function invocations, compute, and image-route durations. Consult current provider pricing rather than assuming free-tier quotas are permanent. Supabase may pause inactive free projects.

Images are normalized on upload. Fog derivatives are shared between viewers of the same scene revision; oversized derivatives are served without caching if they exceed the bucket's 6 MiB object limit. Large/complex masks can still be expensive, so image and rectangle limits must be revisited after hosted measurements.

The application does not yet schedule automatic asset cleanup. Periodically remove obsolete `masked/<game>/<scene>/<revision>.webp` derivatives, keeping each scene's current revision. Remove orphan originals that are not referenced by any scene/token after verifying the `assets` records. Failed scene/token creation may leave an uploaded asset for later cleanup.

Roll history is retained in Postgres; the UI queries the newest 50 authorized entries. Export before implementing any retention deletion. Continuous dragging writes checkpoints and sends invalidations; reducing movement frequency is the first tuning option if usage is high.

## Recovery and backup

- Keep migration files in source control. Review production migrations and back up data before applying schema changes.
- Supabase database backups do not replace Storage object backups. Export database content and copy private image objects separately.
- Use Supabase's backup/restore tools where the selected plan provides them. Otherwise schedule database dumps with the CLI or `pg_dump` and independently archive Storage objects.
- Test restore into a separate project. Reconfigure keys, authentication redirects, SMTP, private bucket policies, and Realtime publication as necessary.
- To roll back the app, redeploy a known Vercel deployment. Schema changes need a compatible forward migration or a deliberate database restore, not an automatic destructive rollback.
- Application logs should report failed operations without copying service credentials or private sheet/roll payloads.

## Troubleshooting

| Symptom                         | Check                                                                      |
| ------------------------------- | -------------------------------------------------------------------------- |
| Setup page instead of dashboard | Public Supabase environment variables; rebuild after changing them         |
| Magic link fails                | Same browser, unexpired link, site URL, callback allowlist, SMTP           |
| Player sees a dark map          | New scenes start concealed; use Reveal as GM                               |
| Token is absent                 | Active scene, explicit hidden flag, fog at token center                    |
| Player cannot use a saved roll  | Actor control and independent sheet access; save sheet edits first         |
| “Changed” conflict              | Reload the sheet or retry the action using current room state              |
| Reconnecting status             | Supabase project availability, Realtime publication, session validity      |
| Image upload fails              | Server service key, bucket, file type/size/dimensions                      |
| Image processing is slow        | Map complexity/dimensions, revision-cache misses, Vercel function duration |

## Git and deployment workflow

Work on feature branches. CI runs formatting, lint, TypeScript, unit/database tests, build, and infrastructure-free browser smoke tests. Run the opt-in multiplayer suite against a separate Supabase test project before production rollout. Review the PR and merge before selecting the production deployment.

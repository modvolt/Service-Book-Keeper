---
name: drizzle-kit migrate skip logic & prod-deploy verification
description: How drizzle-kit migrate decides what to run, why the dev __drizzle_migrations can look "broken", and how to verify a deploy without prod access.
---

# drizzle-kit migrate: skip-by-timestamp, not by hash

`drizzle-kit migrate` decides what to apply purely by the journal `when` timestamp
(`meta/_journal.json`) vs the max `created_at` in the `drizzle.__drizzle_migrations`
table. It runs every journal entry whose `when` > last recorded `created_at`. The
stored per-migration **hash is NOT used** for the skip decision.

**Consequences:**
- Editing the SQL of an already-applied migration (e.g. to make it idempotent) is
  safe — it will NOT re-run, because skip is timestamp-based. So hardening
  0008/0009 with `ADD COLUMN IF NOT EXISTS` / `DROP COLUMN IF EXISTS` after they
  were committed does not risk a re-run on a prod that already applied them.
- DO $$ ... $$ blocks are sent as a single statement (drizzle splits only on
  `--> statement-breakpoint`), so guarded backfills work under migrate. The
  baseline 0000 already relies on this.

# Dev __drizzle_migrations being "out of sync" is expected here

This project uses `push` for dev fast-iteration and `migrate` only on the prod
container boot (`docker-entrypoint.sh`). So the **dev** DB's
`drizzle.__drizzle_migrations` may record only the first couple of migrations
while the schema has been pushed far ahead — that's normal and irrelevant to prod.
Do NOT "fix" dev by running migrate against it; it would try to re-run old
non-idempotent ALTERs and fail. A continuously-deployed prod, by contrast, has a
fully-populated journal table because migrate runs on every boot.

# Verifying a deploy without prod access (self-hosted Coolify/Docker)

The real prod DB lives on Coolify and is unreachable from the agent. To verify a
migration deploy is safe, reproduce it on scratch databases on the dev Postgres:
1. Fresh-prod test: `CREATE DATABASE`, run migrate over the full chain, assert the
   final schema + that `__drizzle_migrations` has all rows.
2. Existing-prod upgrade test: copy the `drizzle/` dir to a temp dir, delete the
   new migrations + trim `_journal.json` to the previous deploy's last entry, point
   a temp config's `out` at it, migrate to that state, seed representative rows,
   then run migrate against the **real** config to apply the new migrations and
   assert the schema change + data backfill.
3. Idempotency: run migrate once more; it must be a clean no-op.
Drop the scratch DBs afterward.

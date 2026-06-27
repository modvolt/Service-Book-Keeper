---
name: Verify migrations on a fresh DB, not the dev DB
description: How to verify the prod boot-time migrate path without false failures from the push-provisioned dev DB
---

To verify the production boot path (`drizzle-kit migrate`, run by `docker-entrypoint.sh`) applies all
committed migrations cleanly in order, run it against a **fresh throwaway database**, not the dev DB.

**Why:** the dev DB is provisioned with `drizzle-kit push` (no `__drizzle_migrations` tracking table,
schema already at HEAD). Running `migrate` against it tries to replay every migration from `0000`; only
the baseline is idempotent, so later non-idempotent steps (e.g. drop-column, add-column) error or hang —
a false failure that says nothing about the prod path.

**How to apply:** create a scratch DB on the same server, derive a scratch URL from `DATABASE_URL`, run
`DATABASE_URL=<scratch> pnpm exec drizzle-kit migrate --config ./drizzle.config.ts` from `lib/db`, expect
"migrations applied successfully", then `DROP DATABASE` the scratch. Never point `migrate` at the dev DB.

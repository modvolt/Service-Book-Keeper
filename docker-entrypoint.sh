#!/bin/sh
# AutoServis container entrypoint.
# 1. Apply versioned database migrations (drizzle-kit migrate). This only runs
#    the committed migration files in order and never issues destructive DDL on
#    its own, so production data is safe across schema changes. The baseline
#    migration is idempotent (CREATE TABLE IF NOT EXISTS / guarded constraints),
#    so it safely adopts databases that were previously provisioned via `push`.
#    The user_sessions table that connect-pg-simple relies on is part of the
#    migrations as well.
#    Rollback safety: if a deploy is rolled back to an OLDER image, that image's
#    boot runs migrate with a shorter migration chain. drizzle-kit migrate only
#    applies entries newer than the last recorded one and has no down/rollback
#    path, so a downgrade boot is a safe no-op — it never drops columns/tables or
#    rewrites data (covered by the "accidental rollback" migration smoke test).
# 2. Start the API server, which also serves the built SPA.
set -e

echo "[entrypoint] Applying database migrations (drizzle migrate)..."
pnpm --filter @workspace/db run migrate

echo "[entrypoint] Starting AutoServis server..."
exec node --enable-source-maps artifacts/api-server/dist/index.mjs

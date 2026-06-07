#!/bin/sh
# AutoServis container entrypoint.
# 1. Apply the database schema (idempotent drizzle push; also creates the
#    user_sessions table that connect-pg-simple relies on).
# 2. Start the API server, which also serves the built SPA.
set -e

echo "[entrypoint] Applying database schema (drizzle push)..."
pnpm --filter @workspace/db run push-force

echo "[entrypoint] Starting AutoServis server..."
exec node --enable-source-maps artifacts/api-server/dist/index.mjs

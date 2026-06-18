# syntax=docker/dockerfile:1

# AutoServis — single-container production image (Replit-free).
# Builds the React/Vite frontend and the esbuild-bundled Express API server,
# then serves the SPA + /api from one Node process. Designed for Coolify /
# Hetzner with the accompanying docker-compose.yaml.

# ---------- Builder ----------
FROM node:24-bookworm-slim AS builder
RUN corepack enable
WORKDIR /app

# Install dependencies from the committed lockfile (full workspace context).
COPY . .
RUN pnpm install --frozen-lockfile

# Build the frontend. BASE_PATH=/ serves the SPA at the domain root; PORT is
# only read while loading vite.config and is irrelevant to the static output.
# REPL_ID is unset here, so the Replit-only dev plugins are never imported —
# the production bundle is 100% Replit-free.
# NODE_OPTIONS caps V8's old-space so it garbage-collects deterministically and
# keeps RSS bounded under the container's 4GB limit instead of being OOM-killed.
# 2560 (not 3072/4096) deliberately leaves >1GB headroom for everything outside
# the V8 old-space heap: young/code/large-object spaces, Node native allocs, the
# pnpm wrapper, Rollup plugins, esbuild's separate native child (NODE_OPTIONS
# doesn't apply to it), BuildKit, and any concurrent old-app+db pressure during a
# zero-downtime deploy. Local build peaks ~1.3GB summed RSS, so 2560 is safe.
RUN NODE_OPTIONS=--max-old-space-size=2560 NODE_ENV=production BASE_PATH=/ PORT=3000 \
    pnpm --filter @workspace/autoservis run build

# Build the API server bundle (esbuild -> artifacts/api-server/dist/index.mjs).
RUN NODE_OPTIONS=--max-old-space-size=2560 pnpm --filter @workspace/api-server run build

# ---------- Runtime ----------
FROM node:24-bookworm-slim AS runtime
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

# Copy the fully built workspace: the API bundle + pino workers, the frontend
# build output (served as static files), and node_modules. node_modules is kept
# whole because the esbuild bundle externalizes native packages (@aws-sdk/*,
# @google-cloud/*, nodemailer, ...) that must exist at runtime, and the
# boot-time migration step uses drizzle-kit + the committed lib/db/drizzle files.
COPY --from=builder /app /app

EXPOSE 8080

# Entrypoint applies committed DB migrations (drizzle-kit migrate) then starts
# the server. The script is invoked via sh so no executable bit is required.
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]

# AutoServis

Czech-language auto service management app for a self-employed mechanic — tracks vehicles, service history, and work orders with photo capture.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev-only fast iteration; no migration files)
- `pnpm --filter @workspace/db run generate` — generate a versioned migration after changing the Drizzle schema (commit the new files in `lib/db/drizzle/`)
- `pnpm --filter @workspace/db run migrate` — apply committed migrations (what the prod container runs on boot; safe to run in dev too)
- Required env: `DATABASE_URL` — Postgres connection string
- Auth/session env: `APP_PASSWORD` (login password, bootstraps the single auth row), `SESSION_SECRET` (signing key; fail-fast in production), `ALLOWED_ORIGINS` (comma-separated CORS allowlist; reflected in dev)
- Storage env: `STORAGE_DRIVER` = `replit-gcs` (default, dev) or `s3` (prod). For `s3`: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (default `auto`), `S3_FORCE_PATH_STYLE` (default `true`), `S3_PRIVATE_PREFIX` (default `private`), `S3_PUBLIC_PREFIX` (default `public`)
- AI env: `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` (provided by the Replit OpenAI integration in dev; set manually in prod, e.g. base URL `https://api.openai.com/v1`). `OPENAI_MODEL` selects the chat model (default `gpt-5.4`)
- Email env (optional): `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT` (default 587), `SMTP_SECURE`, `MAIL_FROM`; `APP_URL` is the trusted public origin for password-reset links

## Self-hosted deploy (Coolify / Docker)

- Production runs as a single Replit-free container: `Dockerfile` builds the Vite frontend (with `BASE_PATH=/`) and the esbuild API bundle, then one Node process serves both the SPA (static + SPA fallback) and `/api` from the same origin (no CORS needed).
- `docker-compose.yaml` defines the `app` + a `postgres:16` `db` (named volume `db-data`). `.env.example` documents every variable; copy to `.env` and fill in. Deploy: `docker compose up -d --build`. In Coolify, use a Docker Compose resource (its proxy provides HTTPS in front of `app`'s port 8080).
- The `app` service uses `expose: ["8080"]`, NOT a `ports:` host mapping. Coolify's reverse proxy reaches the container over the internal `coolify` network and routes by domain; publishing a host port (e.g. `0.0.0.0:8080`) collides with Coolify's own proxy and fails at container start with `Bind for 0.0.0.0:8080 failed: port is already allocated`. For a plain `docker compose up` without Coolify, add `ports: ["${APP_PORT:-8080}:8080"]` back to the `app` service.
- The container entrypoint (`docker-entrypoint.sh`) runs `drizzle-kit migrate` on boot (applies only the committed versioned migrations in `lib/db/drizzle/`, in order — never auto-generated destructive DDL, so prod data is safe across schema changes). The `user_sessions` table (connect-pg-simple) is part of the migrations. The runtime image keeps full `node_modules` because the esbuild bundle externalizes native packages (`@aws-sdk/*`, `@google-cloud/*`, `nodemailer`) and the boot-time migrate needs `drizzle-kit`.
- Migration workflow: change the Drizzle schema → `pnpm --filter @workspace/db run generate` → review + commit the new `lib/db/drizzle/*.sql` files → deploy. The container applies them automatically. The baseline migration (`0000`) is idempotent (`CREATE TABLE IF NOT EXISTS`, `DO $$`-guarded FK constraints, `CREATE INDEX IF NOT EXISTS`) so it cleanly adopts a database that was previously provisioned with `push --force` without erroring or touching existing data.
- Replit-free production: the `@replit/*` Vite dev plugins (cartographer, runtime-error-modal, dev-banner) have been removed entirely from `autoservis` and `mockup-sandbox` (package.json, vite configs, and the workspace catalog), so no `@replit/*` package is present in the production image's `node_modules`. Replit dev still runs (the app and HMR work) — it just no longer loads Replit's optional dev overlay.
- When the SPA is served by Express in prod, helmet's CSP applies to the HTML: `img-src`/`worker-src` add `blob:` (photo previews, service worker) and the PWA registers via an external `registerSW.js` (`injectRegister: "script"`) to satisfy `script-src 'self'`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, shadcn/ui, wouter router
- API: Express 5, contract-first OpenAPI → codegen (Orval)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, `drizzle-zod`
- Photo storage: pluggable driver — Replit Object Storage (GCS) in dev, S3-compatible (Hetzner) in prod
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (vehicles, service-records, work-orders, photos, materials)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/storage/` — storage driver abstraction (facade + GCS/S3 drivers)
- `artifacts/autoservis/src/pages/` — React pages (dashboard, vehicles, work-orders)
- `artifacts/autoservis/src/components/` — Shared UI (layout, shadcn components)

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → React Query hooks + Zod schemas. Never hand-write API client code.
- Storage driver abstraction (`src/lib/storage/`): `StorageDriver` interface with `replit-gcs` (dev) and `s3` (Hetzner prod) implementations, selected via `STORAGE_DRIVER`. `ObjectStorageService` is the driver-agnostic facade used by routes.
- Uploads always proxy through the server (multer in-memory → `storage.uploadPrivateObject(buffer, contentType)`); no presigned client-side upload, so no bucket CORS is needed. Objects use the stable `/objects/<entityId>` path regardless of backend.
- Work order photos use direct `fetch` POST with FormData (not codegen) because multipart upload isn't in the OpenAPI spec.
- Objects served by streaming through `/api/storage/objects/*` (private, behind `requireAuth`) and `/api/storage/public-objects/*` (public). Both stream a Node `Readable` from the active driver.
- Readiness gate (`/api/healthz`, used by the docker-compose healthcheck + Coolify proxy) returns 200 once the **database** is reachable. Object storage is still probed and reported in the body (`storage: ok|failing`) but does NOT gate health — a degraded/misconfigured S3 only breaks photo upload/serving, it must never keep the whole site from being routed. (Storage healthCheck is a `HeadBucketCommand`, which some S3-compatible providers 403 without `s3:ListBucket` even when object GET/PUT work — another reason it can't gate the site.)

## Product

- Dashboard: open work orders count, completions this month, STK expiry warnings, recent orders list
- Vehicles: list by SPZ (license plate) with STK status indicators, search, add/edit vehicle
- Vehicle detail: basic info, service status (STK, oil change, brakes, timing), service history log
- Work orders: create with SPZ entry (auto-resolves vehicle), service item checkboxes, status tracking, paid flag (Zaplaceno) toggled on the detail page and shown as a badge in the list
- Work order detail: edit status/items, add photos from mobile camera or file upload (XHR upload progress bar + Czech error toasts)
- Načtení vozu (`/nacteni-vozu`, old `/nacteni-tp` kept as alias): mobile-first scan of vehicle docs (TP, or SPZ + VIN) plus optional dashboard photo; AI extracts SPZ/VIN/make/model/year/displacement and odometer km. Live phone→PC handoff via SSE: phone POSTs the scan, server resolves SPZ and broadcasts a routing decision to other open sessions — unknown SPZ → pre-filled new-vehicle form, known SPZ → new work order. Km is prefilled only when scanned km > stored `currentKm`. Phone shows "Odesláno do PC" (delivered) or an open-on-PC message (no PC connected). Always review-then-confirm; nothing is saved silently.
- Materials catalog (`/materials`): manage stock/parts catalog (name, product number, unit, default price, supplier); items suggested when writing work orders. Supplier price-list import (CSV/XLSX) with client-side parse, column mapping, supplier override, and server-side upsert matched by product number (case-insensitive) with name fallback
- GDPR (`/gdpr`): search personal data (by name/phone/email/SPZ), per-vehicle export (JSON download), anonymize (strip owner + appointment PII, keep technical history), permanent delete (vehicle + work orders + appointments + service records + photo blobs), record/withdraw processing consent (`vehicles.consentGivenAt`/`consentNote`), and an audit-log viewer
- PWA: installable (manifest + service worker via `vite-plugin-pwa`, `registerType: autoUpdate`). Manifest `start_url`/`scope` use Vite `base` (BASE_PATH); icons in `public/` (pwa-192, pwa-512, pwa-maskable-512, apple-touch-icon)

## User preferences

- Czech UI language throughout (no English labels visible to users)
- No emojis
- Desktop-first, simple clean UI

## Gotchas

- `zod/v4` subpath import doesn't resolve in esbuild — always import from `"zod"` directly in api-server routes.
- After any route changes, the API server must be restarted (it builds before starting).
- `pnpm --filter @workspace/api-server add <pkg>` to add runtime deps to the server.
- `materials_catalog` uniqueness is case-insensitive via a `lower(name)` unique index (not the plain column). The import upsert branches on a case-insensitive existing-name set; bulk import uses a route-local 10mb JSON parser (global limit is 1mb).
- `vite` is pinned in the catalog alongside `terser` (catalog entry). `terser` must stay a devDependency of every vite-consuming package (autoservis, mockup-sandbox) — `vite-plugin-pwa` pulls terser and otherwise splits vite into two TS-incompatible variants, breaking an unrelated package's typecheck.
- `BASE_PATH` is normalized in `vite.config.ts` to always have leading+trailing slashes so PWA `start_url`/`scope`/`navigateFallback` concatenate correctly.
- `drizzle-kit generate` fails with an ENOENT on `.//home/...snapshot.json` because the config's `out` is an absolute path and drizzle prepends `./`. Run it from cwd `/` (e.g. `cd / && lib/db/node_modules/.bin/drizzle-kit generate --config <abs path>`) so the `.//abs` collapses to the correct absolute path. `push`/`migrate` are unaffected.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

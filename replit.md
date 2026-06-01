# AutoServis

Czech-language auto service management app for a self-employed mechanic — tracks vehicles, service history, and work orders with photo capture.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Auth/session env: `APP_PASSWORD` (login password, bootstraps the single auth row), `SESSION_SECRET` (signing key; fail-fast in production), `ALLOWED_ORIGINS` (comma-separated CORS allowlist; reflected in dev)
- Storage env: `STORAGE_DRIVER` = `replit-gcs` (default, dev) or `s3` (prod). For `s3`: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (default `auto`), `S3_FORCE_PATH_STYLE` (default `true`), `S3_PRIVATE_PREFIX` (default `private`), `S3_PUBLIC_PREFIX` (default `public`)

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

## Product

- Dashboard: open work orders count, completions this month, STK expiry warnings, recent orders list
- Vehicles: list by SPZ (license plate) with STK status indicators, search, add/edit vehicle
- Vehicle detail: basic info, service status (STK, oil change, brakes, timing), service history log
- Work orders: create with SPZ entry (auto-resolves vehicle), service item checkboxes, status tracking
- Work order detail: edit status/items, add photos from mobile camera or file upload (XHR upload progress bar + Czech error toasts)
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

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

# AutoServis

Czech-language auto service management app for a self-employed mechanic — tracks vehicles, service history, and work orders with photo capture.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, shadcn/ui, wouter router
- API: Express 5, contract-first OpenAPI → codegen (Orval)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, `drizzle-zod`
- Photo storage: Replit Object Storage (GCS)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (vehicles, service-records, work-orders, photos)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/autoservis/src/pages/` — React pages (dashboard, vehicles, work-orders)
- `artifacts/autoservis/src/components/` — Shared UI (layout, shadcn components)

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → React Query hooks + Zod schemas. Never hand-write API client code.
- Object storage for photos: multer in-memory → direct GCS PUT via presigned URL → store path in DB.
- Work order photos use direct `fetch` POST with FormData (not codegen) because multipart upload isn't in the OpenAPI spec.
- Photos served via `/api/storage/objects/*` (objectStorage.ts helper reads from GCS).
- Storage route inlines its Zod schemas (does not import from `@workspace/api-zod`) because the upload-url endpoint isn't in the OpenAPI contract.

## Product

- Dashboard: open work orders count, completions this month, STK expiry warnings, recent orders list
- Vehicles: list by SPZ (license plate) with STK status indicators, search, add/edit vehicle
- Vehicle detail: basic info, service status (STK, oil change, brakes, timing), service history log
- Work orders: create with SPZ entry (auto-resolves vehicle), service item checkboxes, status tracking
- Work order detail: edit status/items, add photos from mobile camera or file upload

## User preferences

- Czech UI language throughout (no English labels visible to users)
- No emojis
- Desktop-first, simple clean UI

## Gotchas

- `zod/v4` subpath import doesn't resolve in esbuild — always import from `"zod"` directly in api-server routes.
- After any route changes, the API server must be restarted (it builds before starting).
- `pnpm --filter @workspace/api-server add <pkg>` to add runtime deps to the server.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

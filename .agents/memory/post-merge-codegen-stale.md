---
name: Post-merge leaves API codegen stale
description: After a task-agent merge, regenerate Orval codegen if the OpenAPI spec changed; post-merge setup only runs drizzle push.
---

After a task agent's work is merged, the platform's post-merge/reconciliation
step runs the DB sync (`drizzle push`/migrate) but does **not** run the API
codegen. If the merged work changed `lib/api-spec/openapi.yaml` (new fields,
endpoints, schemas), the generated client (`@workspace/api-zod` + React Query
hooks) is stale and the frontend typecheck fails with missing types/exports.

**Fix:** run `pnpm --filter @workspace/api-spec run codegen`, then
`pnpm run typecheck`. Codegen is idempotent — safe to run anytime.

**Why:** seen when a merged task added `isFleet`/loaner fields to the spec but
the autoservis frontend had no matching generated types until codegen was rerun.

**How to apply:** after any merge that touched the OpenAPI spec (or whenever the
frontend reports missing generated API types that "should" exist), regenerate
codegen before debugging the actual imports.

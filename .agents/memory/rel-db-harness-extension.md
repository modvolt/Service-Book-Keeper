---
name: rel-db harness extension for new drizzle features
description: When a tested route starts using a drizzle feature the in-memory rel-db harness doesn't implement, the route 500s; extend the engine, don't guess at the route.
---

The api-server test harness in `src/test-support/rel-db/` is a hand-written
in-memory stand-in for drizzle, mocked in via `vi.mock("@workspace/db")`,
`vi.mock("drizzle-orm")`, `vi.mock("drizzle-orm/pg-core")`. It only implements
the subset of drizzle features the already-tested routes happened to use.

**Symptom:** a route under test returns 500 (not a clear error) because the
mocked module throws e.g. `No "getTableColumns" export is defined on the
"drizzle-orm" mock`, or a builder method like `.onConflictDoUpdate(...)` /
`db.execute(...)` / `sql.identifier(...)` is `undefined`. The route's
`req.log.error` is usually a `vi.fn()` so the error is swallowed — temporarily
point `log.error` at `console.error` in the test's `makeApp` to surface it.

**Fix:** add the missing capability to `engine.ts` and re-export it through the
matching mock file (`orm-mock.ts` for `drizzle-orm`, `pgcore-mock.ts` for
`drizzle-orm/pg-core`). Things added when testing the full-backup import:
- `InsertBuilder.values(...).onConflictDoUpdate/onConflictDoNothing` — upsert by
  `id`, ignoring the `set` sql markers (the proposed row already carries values).
- `db.execute(query)` — no-op returning `[]` (used for raw `setval` to realign
  sequences after import).
- `sql.identifier` / `sql.raw` — minimal markers; engine ignores the text.
- `getTableColumns(table)` — returns name→{name,dataType}; infer `dataType`
  ("date" for `*At` timestamp cols, else "string") so `coerceRows` rehydrates
  timestamp ISO strings into `Date` and drops unknown columns.

**Why:** trust the route — it mirrors real drizzle. The harness is the
incomplete side, so extend the harness rather than reshaping the route to dodge
an unimplemented feature.

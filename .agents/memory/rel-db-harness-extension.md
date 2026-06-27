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

Predicate-level `sql` (e.g. retention's `lt(sql\`coalesce(${a}, ${b})\`, cutoff)`):
the `sql` marker must capture its interpolated values and `resolve()` must
special-case `coalesce(...)` (first non-null) — otherwise the marker resolves to
a string and every comparison is wrong. Add new aged columns (`legalBasis`,
`createdAt`, `consent_history` table) to the `makeTable` lists + re-export.

**Live-reference aliasing pitfall:** a `select(*)` returns the *live* store row
object, and `update().set()` mutates that same object in place. So a route that
reads a column *after* issuing its own update sees the post-update value (unlike
real drizzle, where the earlier select result is a detached snapshot). Symptom:
a history/event classification that depends on the prior value comes out wrong
only under test. Fix the route to capture prior state *before* the write (correct
in prod too); don't work around it in the harness.

**Why:** trust the route — it mirrors real drizzle. The harness is the
incomplete side, so extend the harness rather than reshaping the route to dodge
an unimplemented feature. The one exception is the live-reference aliasing above:
that's a real fragility (read-after-write), so fix the route to read prior state
first.

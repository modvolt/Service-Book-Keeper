---
name: Inline-mock route tests break on new drizzle imports
description: api-server route tests that inline-mock drizzle-orm break (500s) when the route adds a new operator import the mock doesn't export.
---

Some api-server route tests (e.g. scan-handoff, scan-materials) `vi.mock("drizzle-orm", ...)` with a hand-written subset of operators instead of using the shared rel-db test engine. If a route later imports a new operator (e.g. `isNull`, `and`), the mock returns `undefined` for it, the route throws, and the handler 500s — failing tests that have nothing to do with the change.

**Why:** the inline mock is an allow-list; a new operator import silently falls outside it.

**How to apply:** when you add a drizzle operator import to a route, grep its test for an inline `vi.mock("drizzle-orm"`. If present, add the new operator to the mock AND teach its `matchRow`/`where` evaluator the new predicate (e.g. `isNull` → `row[col] == null`), and seed/filter `deletedAt` so soft-delete filtering behaves. Prefer the shared rel-db engine for new tests to avoid this entirely.

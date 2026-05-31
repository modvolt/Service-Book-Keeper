---
name: connect-pg-simple session table under esbuild
description: Why the session store table must be created via Drizzle, not createTableIfMissing
---

# connect-pg-simple `createTableIfMissing` fails in the esbuild bundle

`createTableIfMissing: true` reads a `table.sql` file relative to the
connect-pg-simple module dir. In the api-server's esbuild CJS bundle that path
resolves to `dist/table.sql`, which does not exist → `ENOENT` on every session
write. The failure is **silent to the client**: login returns 200 and sets a
cookie, but the session row is never persisted, so the next request reads
`authenticated: false` (looks like a phantom auth/session bug).

**Rule:** define the session table in the project's Drizzle schema and create it
via the normal `db push`/migration path. Set `createTableIfMissing: false`.

**Why:** the bundler does not ship connect-pg-simple's SQL asset; managing the
table through the normal schema/push path also makes prod (Coolify) deploys
deterministic.

**How to apply:** whenever a Node server that bundles with esbuild uses a
session/queue/etc. library that auto-creates its own SQL tables from a packaged
`.sql` file, pre-create the table via the project's migration path instead of
relying on the library's runtime auto-create.

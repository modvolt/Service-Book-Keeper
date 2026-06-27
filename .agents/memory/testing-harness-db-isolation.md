---
name: testing-harness DB isolation
description: Why runTest [DB] steps and executeSql can't set up data or seed credentials this app actually reads.
---

# Testing harness / executeSql hit a different DB than the app

In this environment, `executeSql` (the code-execution sandbox) and the `runTest`
testing harness `[DB]` steps connect to a built-in Postgres named `heliumdb`
(local unix socket, `inet_server_addr()` null). The **app** connects via
`process.env.DATABASE_URL` (plus `PG*` secrets) to a *different*, external
Postgres. `checkDatabase()` reports "not provisioned" because the user replaced
the Replit-managed DB with their own external one.

**Consequence:** any test setup that injects rows or seeds credentials through
`[DB]` / `executeSql` never reaches the database the app reads. DB-injection
e2e tests and "seed a known bcrypt hash then log in" workarounds silently fail.

**How it was proven (three independent signals):**
- Deleted `app_auth` id=1 in heliumdb, hit `/api/auth/login` → app did NOT
  re-seed a row in heliumdb (login re-seeds from `APP_PASSWORD` when the row is
  absent), yet still returned 401 from its own DB.
- Seeded the exact bcrypt hash of a known password into heliumdb's `app_auth`;
  both curl and a `runTest` UI login were rejected (401).
- Failed logins from today never appeared in heliumdb's `audit_log`.

**How to apply:**
- Before writing a DB-injection or seeded-credential test, confirm the harness
  DB == the app DB. Quick check: `executeSql` `SELECT current_database()` and
  compare against the app's `DATABASE_URL` behavior (e.g. the delete-and-reseed
  probe above). If they differ, DB injection is useless.
- Prefer **pure-UI** test setup (create/delete entities through the app's own
  screens) so the test only needs a working login — no DB access at all.
- Login still needs a real credential: `APP_PASSWORD` is an unreadable secret,
  the stored hash may have been changed in-app since seeding, and seeding a hash
  via the harness won't reach the app DB. The only reliable unblock is the user
  providing/seting a known admin password through the running app.

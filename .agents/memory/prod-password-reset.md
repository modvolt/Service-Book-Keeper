---
name: Prod password / data changes need an Overwrite-data republish
description: Why editing APP_PASSWORD or agent SQL can't change the published admin password, and the supported path to change prod DATA.
---

# Changing values that live in production DATA (e.g. the admin login password)

- The admin login password lives in the `app_auth` DB row as a bcrypt hash. It is seeded from the `APP_PASSWORD` env/secret **only when the row is absent** (seed-once). `/auth/login` seeds on its first call, so even one failed login locks the row. After that, changing `APP_PASSWORD` does nothing to the stored password.
- **Dev and production are SEPARATE databases.** Production starts as a copy of dev at first publish (so their rows can have byte-identical hashes early on), but later writes do NOT propagate either way. Agent `executeSql({environment:"production"})` is READ-ONLY, so the agent cannot write the prod row at all.
- To change something that lives in prod DATA: change it in the **dev** DB, then have the user **re-publish and choose "Overwrite data"** in the Publish UI (replaces prod data wholesale with dev data). A normal publish only diffs/applies SCHEMA, never data.

**Why:** seed-once + read-only prod + separate DBs means there is no agent-side write path to production data; "Overwrite data" on republish is the only supported mechanism.

**How to apply:** First compare dev vs prod row counts. Safe when dev and prod data are near-identical. If prod has diverged real data, warn the user that "Overwrite data" replaces ALL prod data with the dev snapshot. Alternatively, the *current* prod password still equals the `APP_PASSWORD` secret value (user can view it in the Secrets tab and log in without any change).

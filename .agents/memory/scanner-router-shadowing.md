---
name: Scanner router shadowing + write authorization
description: Dual-role route trap in api-server's scanner/admin router composition, and how scanner writes are authorized.
---

# Scanner-accessible router shadows the admin router on shared paths

`app.ts` mounts the scanner-accessible router (under `requireScannerOrAdmin`) **before**
the admin router (under `requireAdmin`). Admins also pass `requireScannerOrAdmin`. So for
any path registered on **both** routers (dual-role paths like `GET /work-orders` and
`POST /work-orders/:id/materials`), the scanner router's handler runs first and wins for
**everyone, including admins**.

**Why this bites:** giving the scanner a *scoped* handler on the scanner router silently
shadows the admin's full handler — admins start getting the narrowed behavior (empty list
without search, PII stripped, etc.) with no error. The bug is invisible in either router
read alone; you only see it from the mount order in `app.ts`.

**How to apply:** for a dual-role path, register a **single role-branching handler** on the
scanner router, e.g. `req.session.role === "scanner" ? scopedHandler : adminHandler`. Do not
register the same path on both routers expecting the admin router to handle admins.

# Scanner write authorization is bound to the scanned plate, not a token

Scanner material-add (`POST /work-orders/:id/materials`, scanner branch) requires an `spz`
in the body and authorizes the write by compacted, case-insensitive equality against the
target order's `licensePlate` (same comparison as the scoped lookup). Without it a scanner
could append materials to any open order by guessing its numeric id (write IDOR).

**Why plate-equality and not a signed scan token:** the "scanner" is a trusted single-shop
employee; "knows the exact plate" is an acceptable authorization boundary, and the scan UI
already has the confirmed plate. A short-lived signed scan-session token is only warranted
if scanner users become untrusted/external. Check order: missing order → 404, then spz
missing/mismatch → 403 (checked **before** the completed check so it never leaks the state
of an order the scanner has no claim to), then completed → 409, then insert. Scanner add
never writes to the materials catalog (catalog CRUD stays admin-only).

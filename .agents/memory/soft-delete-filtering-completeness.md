---
name: Soft-delete filtering completeness
description: When adding soft-delete (deletedAt), every read/get/update/link query — not just list endpoints — must exclude deleted rows.
---

When a table gains a soft-delete column (`deletedAt`), filtering only the obvious list/get endpoints is not enough. Every query that reads, updates, or resolves a foreign key to that entity must add `isNull(table.deletedAt)`, or deleted rows leak back in through secondary paths.

**Why:** soft-delete is a cross-cutting invariant, but the queries that enforce it are scattered. A code review of an AutoServis soft-delete rollout found ~9 bypass paths that the main list/get handlers' filtering missed entirely.

**How to apply:** after wiring soft-delete, grep every route file for `.from(<table>)` and `eq(<table>.id` / `ilike(<table>.licensePlate` and confirm each has a matching `isNull(<table>.deletedAt)`. Easy-to-miss categories:
- update/PATCH "load existing" pre-checks
- side-channel reads: `/:id/qr`, `/:id/recompute-status`, `/:id/reminder-log`
- typeahead/suggestion queries (e.g. customer-suggestions)
- FK resolution during create/update on a *different* entity (appointment/service-record resolving a vehicle by plate/id)
- photo/child re-reads in a patch response
- scan/AI catalog reads (fuzzy ilike match, QR inArray lookup, full-catalog fetch)

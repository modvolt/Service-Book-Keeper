---
name: GDPR erasure ordering
description: How permanent GDPR deletion of a vehicle must be sequenced to stay complete and atomic.
---

# GDPR vehicle erasure

Permanent deletion (`DELETE /gdpr/vehicle/:id`) must:

1. **Delete object-storage blobs FIRST**, before any DB mutation. If any blob
   delete fails, abort with 500 and leave the DB untouched. `deleteObject` is
   idempotent, so the client can safely retry.
2. **Wrap all DB deletes in a single `db.transaction`** (work orders → appointments
   → vehicle).

**Why:** returning success while photo blobs survive in storage is a hard GDPR
right-to-erasure violation; non-transactional deletes can leave partial state.
Both were flagged as production blockers in review.

**How to apply:** any new child table holding PII tied to a vehicle must be added
to the delete transaction. Note `appointments.vehicleId` and `work_orders.vehicleId`
use `onDelete: set null` (NOT cascade), so they are deleted explicitly; only
`service_records` and `photos` cascade. Anonymize and consent changes must also be
transactional/audited respectively.

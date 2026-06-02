---
name: Customer reminder de-duplication
description: How customer-facing STK/service reminder emails avoid re-notifying about the same deadline.
---

Customer reminders (owner-facing STK/service emails) are de-duped via the
`customer_reminder_log` ledger: one row per (vehicleId, reminderKey, dedupeToken)
that was already emailed. An owner is emailed about a deadline at most once.

**The dedupeToken must anchor on the resolved-deadline point, never on live odometer.**
- STK: `stk:<stkValidUntil>`
- service items: `<key>:<lastServiceDate>:<lastServiceKm>` (the "last service" anchor)

**Why:** the token has to stay stable while a deadline is pending and only change
once the deadline is resolved (STK renewed → new expiry date; oil changed → new
last-service date/km). If `currentKm` were part of the token it would change on
every odometer update and the customer would be re-emailed constantly.

**How to apply:** when adding a new reminder kind, give it a stable `AlertKey` and
build its token from its own "last done / next due" anchor only. After a
successful send, insert ledger rows (`onConflictDoNothing`); never insert on send
failure so it retries next tick.

Other constraints:
- Consent gate: only email vehicles with `consentGivenAt` set AND an `ownerEmail`.
- Global on/off reuses `settings.emailRemindersEnabled` (same switch as the
  mechanic digest); there is no separate customer toggle.
- The scheduler tick is idempotent (ledger dedups), so unlike the once-per-day
  mechanic digest it needs no per-day guard.
- GDPR: ledger rows cascade-delete with the vehicle; anonymize explicitly deletes
  them. The token holds only dates/km (no PII).

---
name: Scan km-prefill gating
description: When a scanned odometer reading may prefill a form, only carry it when strictly greater than the stored currentKm.
---

A scanned/extracted odometer reading is only ever prefilled into a known
vehicle's work order when it is **strictly greater** than that vehicle's stored
`currentKm`; otherwise the prefill km must be `null` (leave the field empty for
the mechanic to fill).

**Why:** odometers only go up. A lower-or-equal reading is almost always an OCR
misread or a stale photo, and silently lowering the recorded km corrupts service
history and STK/oil-change interval math.

**How to apply:** this rule is enforced in two independent places that must stay
in lockstep — the server scan-handoff decision (known SPZ → work-order branch)
and the client-side local fallback on the scan page (when the same device
continues without a PC). New-vehicle prefill has no stored value to compare
against, so it always carries the scanned km. If you add another path that turns
a scanned reading into a km prefill, apply the same `> currentKm` gate.

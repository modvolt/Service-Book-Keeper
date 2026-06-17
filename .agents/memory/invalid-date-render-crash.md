---
name: Invalid date render crash (Vozidla list)
description: A single bad date value (e.g. 5-digit year from an AI scan) crashes a whole React list page via date-fns format throwing "Invalid time value".
---

# "Invalid time value" crashes a list page

A Postgres `date` column is always a real calendar date, BUT it can hold an
absurd year (e.g. `36330-06-01`) — `date` accepts years up to ~5 digits. The
AutoServis AI document-scan (TP/SPZ) extracted such a malformed STK year and
saved it. `parseISO("36330-06-01")` returns `Invalid Date` (5-digit year is not
valid ISO 8601), so `format(date, ...)` throws `RangeError: Invalid time value`,
which takes down the **entire** page render (here the Vozidla list, immediately
on open).

**Why it's a trap:** a null/empty guard (`if (!dateString) return null`) does
NOT catch a present-but-invalid value. And the value looks clean in a
`stk_valid_until::text` dump unless you check the year width / range.

**How to apply:** every date render must validate the *parsed* value before
formatting — `const d = parseISO(s); if (!isValid(d)) return <fallback>;` — not
just check for null. Applies to any `format`/`differenceIn*` call fed by
user/scan-sourced dates. The reusable `formatCzDate` helper already does this
(parseISO → isValid → try/catch); prefer it over raw `format(parseISO(...))`.

**Prevention option (not yet done):** clamp/validate dates on input
(create/edit + scan import) to a sane year range (e.g. 1900–2100) so a scan typo
can't persist an out-of-range year in the first place.

**Debugging note:** the read-only production replica (`executeSql`,
environment: "production") reliably prints single-row aggregates over ALL rows
(`min`/`max`/`count` with no WHERE), but row-level SELECTs and any query with a
WHERE/FILTER/CASE-comparison render as just `START TRANSACTION / ROLLBACK` with
the rows suppressed. Use `max(col::text)` over the whole table to surface an
out-of-range value rather than a filtered SELECT.

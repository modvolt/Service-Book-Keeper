---
name: SPZ normalization
description: Czech license plates must be persisted in canonical "XXX XXXX" form; the server is the single normalization point.
---

Every endpoint that accepts a license plate (`licensePlate`) and writes it to the database must pass the value through the shared normalizer before insert/update. Clients send whatever the user typed; the server enforces the canonical "XXX XXXX" form (3 alphanumeric chars + space + 4 alphanumeric chars), uppercased. Non-standard plates fall back to a trimmed, uppercased string.

**Why:** Stored plates are used as both display values and lookup keys (e.g. `getVehicleByPlate`, work-order → vehicle linking via `ilike`). If one write path skips normalization, the same physical plate ends up stored under two different strings and the join silently misses. This already bit us once with TP import vs manual create.

**How to apply:** When you add a new endpoint or route that accepts a plate, normalize at the boundary, not in the route body. The helper lives in the api-server's small `lib/spz` module (functions for required string and for nullable inputs). Do not duplicate the regex inline. Plate lookups should use `ilike` (case-insensitive) so legacy non-normalized rows still match while the schema is being migrated.

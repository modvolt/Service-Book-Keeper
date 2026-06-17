---
name: Health gate must not depend on object storage
description: Why /api/healthz readiness gates on the database only, not object storage.
---

The platform/proxy health probe (`/api/healthz`, used by the docker-compose
healthcheck and Coolify's reverse proxy) must return 200 based on REQUIRED
dependencies only — the database. Object storage is reported in the body but
must NOT gate readiness.

**Why:** if storage gates health, an unreachable or misconfigured object store
(e.g. wrong S3 region/endpoint, or a bucket probe the provider rejects) makes the
proxy treat the container as unhealthy and refuse to route ANY traffic — the whole
site goes dark even though pages, auth, vehicles, and work orders work fine without
photos. Symptom seen in prod: server logs "Server listening" + "database: ok,
storage: failing", healthz 503 forever, nothing served on the web.

**Extra trap:** the S3 healthCheck is a `HeadBucketCommand`. Some S3-compatible
providers (incl. Hetzner setups) return 403 for HeadBucket without `s3:ListBucket`
permission even when object GET/PUT/DELETE work — so a "storage: failing" status
does not even reliably mean photos are broken. Never gate the site on it.

**How to apply:** keep `state.ready = state.database === "ok"`. Add new
gating dependencies to readiness only if the app genuinely cannot serve without
them. Degraded subsystems should surface as reported status + per-feature errors,
never as a total health-gate failure.

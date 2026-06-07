---
name: Docker deploy smoke testing in the Replit workspace
description: How to smoke-test the self-hosted docker-compose deploy from inside the Replit container, and the env limitations that force a non-default setup.
---

Smoke-testing the self-hosted `docker compose` deploy (Dockerfile + docker-compose.yaml + docker-entrypoint.sh) from inside the Replit workspace requires working around two environment limitations of nested Docker. These are NOT deploy defects — the same compose works on a real host / Coolify.

**Env limitations (workaround required):**
- Docker bridge networks drop inter-container traffic (HTTP 000 timeout, even on a freshly created network). Use `network_mode: host` for every service in a test override, and address services via `localhost:<port>`.
- `docker exec` / CMD healthchecks fail with `setns: exit status 1`, so `depends_on: condition: service_healthy` can never pass. In the test override set `healthcheck: { test: ["NONE"] }` and gate `depends_on` on `service_started` / `service_completed_successfully` instead.
- The Docker host namespace == the workspace namespace, so many ports (8080, 18080, 5432, 9000, …) are already taken by Replit internals and the dev app. Pick a free port (e.g. 7100) for the test app via an explicit `PORT`.

**Compose env precedence gotcha:** `docker compose --env-file X` does NOT win over the inherited shell environment for `${VAR}` interpolation. Replit injects real dev secrets (e.g. `APP_PASSWORD`, `SESSION_SECRET`) into the shell, so `${APP_PASSWORD}` resolves to the dev secret, not your test `.env`. To make a test deterministic, set those vars as **literal** values in the override's `environment:` (not `${...}`), and recreate with a fresh DB volume (`down -v`) so any password-hash seed re-runs.

**Prod session cookie is Secure + trust proxy:** over plain `http://localhost`, express-session suppresses the Set-Cookie. Simulate the HTTPS proxy by sending `X-Forwarded-Proto: https`, then replay the cookie manually with `-H "Cookie: ..."` because curl will not auto-send a Secure cookie over an http URL.

**Helper containers** (all via `--network host`): `curlimages/curl` (use `--entrypoint sh`; note its uid 100 cannot write to a runner-owned bind mount — write outputs to `/tmp` inside the container), `postgres:16-alpine` for `pg_isready`/`psql`, `minio/minio` + `minio/mc` for an S3 backend, `busybox`.

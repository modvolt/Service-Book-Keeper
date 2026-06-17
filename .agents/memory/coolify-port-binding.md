---
name: Coolify host-port collision
description: Why the Docker Compose app service must use expose, not a host ports mapping, under Coolify.
---

A Coolify "Docker Compose" deploy that builds fine but dies at container start with
`Bind for 0.0.0.0:8080 failed: port is already allocated` is a host-port collision,
not an app bug. The build, migrations, and DB can all be healthy; only the `app`
container fails to start.

**Rule:** under Coolify the app service must NOT publish a host port. Use
`expose: ["8080"]` so Coolify's reverse proxy (on the internal `coolify` network)
can reach it and route by domain. A `ports: ["8080:8080"]` mapping takes the host
port that Coolify's own proxy already holds.

**Why:** Coolify runs its own proxy bound to common host ports; the container only
needs to be reachable on the internal network, not published to the host.

**How to apply:** keep `expose` for Coolify. Only add a `ports:` mapping back when
running a plain `docker compose up` on a host with no external reverse proxy.

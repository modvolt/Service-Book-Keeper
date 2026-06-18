---
name: Vite build OOM in a memory-capped container
description: Production vite/rollup build is OOM-killed in Docker/Coolify even though it builds fine locally; cap Node heap under the container limit.
---

# Vite/rollup production build OOM-killed in a memory-capped container

Symptom: `vite build` succeeds locally but the deploy build dies during the
`transforming...` phase. The deploy log shows no `JavaScript heap out of memory`
fatal — instead the container is silently killed (e.g. Coolify "Gracefully
shutting down build container", exit 255). That silent SIGKILL = the kernel
cgroup OOM-killer, not a V8 heap error.

**Why:** Node's default heap can be sized too aggressively for a small cgroup
(modern Node is more cgroup-aware but still doesn't guarantee total RSS stays
under the limit). On a big host behind a small (e.g. 4GB) cgroup, V8 + native
allocations let total RSS drift upward during a transient transform-phase spike,
exceed the cgroup limit, and get OOM-killed. The build can peak well below the
limit on a roomy local machine yet still die in the constrained container (which
may also be oversubscribed by the old app + db + proxy during a zero-downtime
deploy).

**How to apply:** In the Dockerfile build step(s), set
`NODE_OPTIONS=--max-old-space-size=<N>` with N well below the container RAM limit
so V8 GCs deterministically and stays bounded. Important: old-space is NOT total
RSS — young/code/large-object spaces, Node native allocs, the pnpm wrapper,
Rollup plugins, and esbuild's separate native child (NODE_OPTIONS does NOT apply
to the esbuild Go binary) all sit outside that cap. So leave generous headroom:
for a 4GB limit use ~2048–2560, NOT 3072/4096. Raise toward 3072 only if V8
itself reports `JavaScript heap out of memory`. Also lower the transform-phase
concurrency spike with `build.rollupOptions.maxParallelFileOps` (e.g. 3, or 2 if
pressure persists) — it died *during* transform, so capping concurrent file
transforms is a targeted defense (minor build-time cost). If a cgroup kill still
persists, raise the Coolify build memory or avoid concurrent old-app+db+build
pressure.

The `(2:0) Error when using sourcemap for reporting an error: Can't resolve
original location of error.` lines on shadcn/Radix components are cosmetic
(rollup mapping a benign "use client" directive warning), not the failure — the
build completes past them locally. Don't chase those; chase the memory limit.

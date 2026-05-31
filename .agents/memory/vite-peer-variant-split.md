---
name: vite peer-variant split (terser)
description: Adding a Vite plugin that pulls an optional Vite peer can split Vite into two TS-incompatible copies and break another package's typecheck.
---

# Vite peer-variant split

Adding a Vite plugin whose dependency satisfies one of Vite's *optional* peer deps (e.g. `vite-plugin-pwa` pulls `@rollup/plugin-terser` → `terser`) makes pnpm resolve a new Vite variant keyed by that peer (`vite@x(...)(terser@y)(...)`). Packages with the plugin get the terser variant; other Vite consumers stay on the no-terser variant. The two `ViteBuilder`/`Plugin` types are then "two different types with this name exist, but they are unrelated", and the *unchanged* package's `tsc` fails on its own `vite.config.ts`.

**Why:** pnpm creates a separate dependency-tree node per resolved peer set; TS sees the two Vite copies as distinct types.

**How to apply:** When a new Vite plugin introduces an optional peer, add that peer (here `terser`) to the `pnpm-workspace.yaml` catalog and list it as a `devDependency` (`"catalog:"`) in *every* Vite-consuming package so the whole workspace resolves a single Vite variant. Verify with `pnpm run typecheck` (the breakage shows up in a package you didn't touch) and confirm only one `vite@...` variant string remains in `pnpm-lock.yaml`.

---
name: Orval path+query param name collision
description: Why adding a query param to an OpenAPI operation that also has path params breaks the zod codegen, and how to avoid it.
---

Adding an `in: query` parameter to an operation that ALSO has `in: path`
parameters breaks `pnpm --filter @workspace/api-spec run codegen` with a TS2308
"already exported a member named `<Op>Params`" error.

**Why:** Orval's zod generator names the *path*-params schema `<Op>Params` and the
*query*-params schema `<Op>QueryParams`. Orval's TS types generator names the
*query*-params type `<Op>Params`. When an operation has both, the api-zod barrel
re-exports two different `<Op>Params` from `./generated/api` and
`./generated/types`, which collide. Operations with only query params don't
collide (zod uses `<Op>QueryParams`, types use `<Op>Params` — different names).
This codebase had no operation with both until trash restore needed a toggle.

**How to apply:** For a POST/PUT/PATCH action that needs an extra flag on a
path-param route, model it as a `requestBody` (a referenced component schema),
NOT a query param. The generated mutation then takes `{ ...pathParams, data }`
and no name collides. Reserve query params for GET/list-style operations that
have no path params.

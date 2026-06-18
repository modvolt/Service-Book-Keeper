---
name: Global vs route-local body-parser ordering
description: Why a route-local large JSON parser silently fails (413) when a global express.json runs first, and how to scope around it.
---

# Global body parser pre-empts route-local large parsers

A global `app.use(express.json({ limit: "1mb" }))` registered before the `/api`
routes parses (and size-checks) the body of **every** matching request first.
Once it runs it sets `req._body`, so a later route-local
`json({ limit: "15mb" })` is a no-op — and for any body over the global limit the
global parser already aborted with **413 Payload Too Large** before the route is
ever reached.

**Symptom:** an endpoint that "installs its own larger parser locally" still 413s
on large payloads in prod (e.g. base64-photo scan upload `/api/vehicles/import-tp`).
A sibling route using the same route-local pattern (`/api/materials/import`,
10mb) appeared to work only because its real payloads happened to stay under the
global 1mb cap — same latent bug.

**Fix:** keep the small global limit (it protects all pre-auth traffic from
resource amplification) but make the global parsers **skip** the known
large-payload paths, so their route-local parsers — which run after the auth gate
— handle the body. Wrap the parser:

```ts
const LARGE_BODY_PATHS = ["/api/vehicles/import-tp", "/api/materials/import"];
function skipLargeBodyPaths(parser: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const path = req.path.length > 1 ? req.path.replace(/\/+$/, "") : req.path;
    if (LARGE_BODY_PATHS.includes(path)) return next();
    return parser(req, res, next);
  };
}
app.use(skipLargeBodyPaths(express.json({ limit: "1mb" })));
```

**Why:** preserves the deliberate small-global-limit security posture while
narrowly allowing the few authenticated endpoints that genuinely need big bodies.

**How to apply:** when adding any new endpoint that needs a body larger than the
global limit, add its path to `LARGE_BODY_PATHS` *and* give the route its own
parser — doing only one of the two silently fails.

## Companion: shrink the payload at the source

Raising limits is not enough on its own. The scan dialog allowed up to 8
full-resolution photos; even at 15mb that overflows. The durable fix is
client-side compression before upload (canvas downscale longest edge ~2000px,
JPEG q~0.82, fall back to the raw file on decode/encode failure). The
import-tp route hardcodes `data:image/jpeg;base64,...`, so encoding to JPEG also
keeps the mime honest.

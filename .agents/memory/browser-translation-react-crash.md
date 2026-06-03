---
name: Browser auto-translation breaks React
description: "insertBefore/removeChild ... is not a child of this node" crashes that survive redeploys are caused by Google/Edge auto-translation, not stale chunks.
---

# Browser auto-translation breaks React

Symptom: production React app throws `Failed to execute 'insertBefore' on 'Node'`
or `removeChild ... is not a child of this node`, and dynamic text (e.g. a
calendar's day names / dates) shows up "wrong". Crucially, it **persists after a
fresh deploy** — so it is NOT a PWA stale-chunk problem.

**Root cause:** Google Translate / Edge auto-translation rewrites text nodes
(wraps them in `<font>` tags). React still holds references to the original text
nodes; when it tries to update/remove them they are no longer direct children of
the expected parent, so the DOM op throws. Pages with frequently-changing text
(calendars, live lists) trigger it most.

**Fix (in `index.html`):**
- `<html lang="cs" translate="no">`
- `<meta name="google" content="notranslate" />`
- `class="notranslate"` on the `#root` container as a secondary hint.

**Why this matters / how to apply:** when an `insertBefore`/`removeChild` crash
survives a redeploy, suspect translation first, not caching. For a single-language
app, disabling translation is safe and is the correct fix. Stale-chunk recovery
(SW cache clear + reload) is a separate concern and does not address this.

---
name: PWA stale-chunk recovery
description: Why post-deploy "removeChild" crashes happen in this PWA and the one-shot reload pattern that recovers from them safely.
---

# PWA stale-chunk recovery

A new deploy can leave the old service worker serving cached `index.html` + JS
chunks that no longer match the freshly built assets. React then throws on
reconcile — classically `Failed to execute 'removeChild' on 'Node'` — or a
dynamic import 404s (Vite `vite:preloadError`). Symptom: app works, then breaks
right after the user refreshes onto a newly published version.

**Mitigations in place:**
- `cleanupOutdatedCaches: true` in the VitePWA `workbox` config so a new SW drops
  previous-build precache entries on activate.
- A one-shot recovery (`src/lib/app-reload.ts`): unregister SW + clear all caches
  + reload once. Wired into the top-level ErrorBoundary (`recover` prop) and a
  `vite:preloadError` listener in `main.tsx`. A manual "Obnovit aplikaci" button
  is the always-available escape hatch.

**Why the guard must not rely on sessionStorage alone:**
If `sessionStorage` throws (private mode / blocked storage) the one-shot flag
never persists, so an auto-reload-on-crash would loop forever. The guard must
have a storage-free fallback — here a `_recovered=1` URL query marker added
during the reload; either the sessionStorage flag OR the URL marker means
"already tried". `markRecoverySuccessful()` clears both after a stable boot
(strip the URL param with `history.replaceState`, no reload).

**How to apply:** any time you add auto-reload-on-error recovery, the
"only once" guard must survive storage being unavailable, or you risk a reload
loop. Test the storage-throws path explicitly.

**Root cause vs mitigation:** the deeper issue that motivated the backup MERGE
work was a republish overwriting the DB. The real fix for data loss is a
persistent DB volume / non-destructive deploys (Coolify); the stale-chunk
recovery only addresses the client-side crash, not data durability.

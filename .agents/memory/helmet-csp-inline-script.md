---
name: helmet CSP blocks inline scripts
description: server-rendered HTML pages can't use inline <script> under helmet's default CSP
---

helmet()'s default Content-Security-Policy sets `script-src 'self'`, which
blocks any inline `<script>` in HTML the API server renders itself (e.g. the
public diagnostics page). The page loads and styles apply (style-src allows
`'unsafe-inline'`), but inline JS silently never runs — symptom is a page
stuck on its initial "loading" text with empty data.

**Why:** helmet is applied app-wide; its CSP is stricter for scripts than
styles, so the failure is easy to miss (CSS works, JS doesn't).

**How to apply:** serve the script as a separate same-origin endpoint
(e.g. `GET /diagnostics.js` with `res.type("application/javascript")`) and
reference it with `<script src="diagnostics.js">`. A relative src resolves
against the page's directory, so keep page + script under the same path
prefix. Don't weaken CSP with `'unsafe-inline'` just to allow one page.

**Same trap for client-created export/print popups:** the frontend's
`window.open(blobUrl)` / `window.open("")` + `document.write` popups (work-order
sheet, statistics export, vehicle history, data backup) are `blob:`/`about:blank`
documents that **inherit the SPA's CSP in production** (Express + helmet). So
inline `onclick="window.print()"` / `onclick="window.close()"` handlers silently
die in prod but work in dev (Vite serves the SPA with no CSP) — the classic
"works in dev, dead in prod" print regression. Fix without touching CSP: the
popup is same-origin, so mark buttons with a `data-*` attribute and attach the
click listeners **from the opener's** script context (its bundle is `'self'`,
allowed) once the popup loads — see `artifacts/autoservis/src/lib/print-window.ts`
(`attachPrintControls`). Never reach for `'unsafe-inline'`/`'unsafe-hashes'`.

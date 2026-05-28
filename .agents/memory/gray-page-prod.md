---
name: Gray page in production only
description: Diagnosing "works in dev, gray/blank page in prod" symptoms in the React+Vite artifacts
---

When a page works in the dev preview but shows a blank/gray page in the deployed
build (especially after navigating between menus or triggering a feature), the
cause is almost always an **uncaught error during React render** that unmounts the
whole tree.

**Why:** In dev, Vite's error overlay catches and displays the thrown error, so it
looks like the app "works" (you see an overlay, not a crash). In a production build
there is no overlay, and without an ErrorBoundary the entire React tree unmounts,
leaving only the page background visible (a gray/blank page).

**How to apply:**
- Every React artifact should have a global ErrorBoundary. Use two layers: an outer
  one wrapping the whole app (catches crashes in the layout/shell itself) and an
  inner one wrapping the routed page content, keyed by location so it auto-resets on
  navigation and keeps the shell visible.
- The boundary is a guardrail, not a root-cause fix. ErrorBoundaries only catch
  render/lifecycle errors, NOT async/event-handler errors. To find the real cause,
  reproduce against a production build (`vite build` + preview), and add durable
  error reporting in `componentDidCatch` rather than console-only logging.

---
name: iOS file input camera capture
description: Why a "take photo" button opens the file picker instead of the camera on iOS PWA
---

On iOS Safari / standalone PWA, a `<input type="file">` that has **both** `multiple`
and `capture` will **ignore `capture`** and open the file/library picker instead of the
camera. Camera capture produces a single photo, so iOS disables it when `multiple` is set.

Dynamically toggling `capture` via `setAttribute`/`removeAttribute` right before
`.click()` is also unreliable on iOS.

**Rule:** to offer both "take photo" and "upload multiple files", use **two separate
hidden file inputs** — a camera one (`accept="image/*" capture="environment"`, no
`multiple`) and an upload one (`accept="image/*" multiple`, no `capture`) — each wired
to its own button.

**Why:** AutoServis "Načtení vozu" scan dialog's camera button only opened the file
picker on iOS because the single input carried `multiple`.

**How to apply:** any camera-capture UI in this app (or any iOS PWA) must keep `capture`
on a `multiple`-free input.

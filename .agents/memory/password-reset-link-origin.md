---
name: Password reset link origin
description: How the reset-password email link base URL is built and why it must not use the request Host header
---

# Password reset link origin

The reset-password email link base URL must come from a trusted source, never from the request `Host` header / `req.get("host")`.

**Why:** Host headers are attacker-controllable (and proxies can pass them through), so building the reset link from the request lets an attacker send the mechanic a phishing reset link pointing at an attacker domain that still carries a valid token. High-severity for password-reset flows.

**How to apply:** Resolve the base URL via `resolveAppBaseUrl()` in `artifacts/api-server/src/routes/auth.ts`: use `APP_URL` when set; in non-production fall back to `https://$REPLIT_DEV_DOMAIN`; otherwise return null and send no email. In production `APP_URL` must be set or reset emails will not be sent. Also: forgot-password must confirm the auth row exists (guard on `getOrSeedHash()` returning non-null) before issuing a token, or the token has nowhere to live and the success message lies.

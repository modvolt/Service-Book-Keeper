// Recovery from a stale PWA version after a new deploy.
//
// When a new version is published, the old service worker can keep serving
// cached chunks/index.html that no longer match the freshly built assets. React
// then tries to reconcile against markup that doesn't exist anymore and throws
// (classic "Failed to execute 'removeChild' on 'Node'"), or a dynamic import
// 404s (Vite's `vite:preloadError`). The fix is to drop the caches, unregister
// the service worker, and reload once so the browser fetches a consistent build.
//
// The "once" guard must survive sessionStorage being unavailable (private mode,
// blocked storage), otherwise a persistent stale chunk would reload forever. So
// we use sessionStorage when we can AND a URL query marker as a storage-free
// fallback — either being present means "already tried this session".

const RECOVERY_FLAG = "autoservis:recovery-reload";
const RECOVERY_PARAM = "_recovered";

function hasSessionFlag(): boolean {
  try {
    return sessionStorage.getItem(RECOVERY_FLAG) != null;
  } catch {
    return false;
  }
}

function setSessionFlag(): void {
  try {
    sessionStorage.setItem(RECOVERY_FLAG, "1");
  } catch {
    // ignore — the URL marker below is the fallback guard
  }
}

function hasUrlMarker(): boolean {
  try {
    return new URLSearchParams(window.location.search).has(RECOVERY_PARAM);
  } catch {
    return false;
  }
}

// True if a recovery reload has already been attempted this session, via either
// the sessionStorage flag or the URL marker.
function alreadyRecovered(): boolean {
  return hasSessionFlag() || hasUrlMarker();
}

async function dropCachesAndServiceWorkers(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // ignore — best effort
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // ignore — best effort
  }
}

// Unregister service workers, clear all caches, then hard-reload. Always runs
// (no guard) — used by the explicit "Obnovit aplikaci" button.
export async function clearCachesAndReload(): Promise<void> {
  await dropCachesAndServiceWorkers();
  window.location.reload();
}

// Attempt an automatic one-shot recovery. Returns true if a reload was triggered,
// false if recovery was already attempted this session (so callers can show a
// manual error screen instead of looping forever).
export function recoverFromStaleVersion(): boolean {
  if (alreadyRecovered()) return false;
  setSessionFlag();
  void dropCachesAndServiceWorkers().then(() => {
    // Reload to a URL carrying the marker so the guard holds even when
    // sessionStorage is unavailable.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(RECOVERY_PARAM, "1");
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  });
  return true;
}

// Called after the app has stayed up for a moment: clears the one-shot guard so a
// future genuine version skew can recover again.
export function markRecoverySuccessful(): void {
  try {
    sessionStorage.removeItem(RECOVERY_FLAG);
  } catch {
    // ignore
  }
  // Strip the marker from the URL without reloading or adding history.
  try {
    if (hasUrlMarker()) {
      const url = new URL(window.location.href);
      url.searchParams.delete(RECOVERY_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  } catch {
    // ignore
  }
}

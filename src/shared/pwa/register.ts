import { registerSW } from 'virtual:pwa-register';

export interface PwaController {
  update: () => void;
}

// One-time migration: the old 'binnacle-pmtiles' worker cache was provably inert (PMTiles range
// reads answer 206, which the Cache API refuses to store), so any orphan it left is deleted.
// PMTiles caching lives in the IndexedDB block cache now. cleanupOutdatedCaches only sweeps the
// precache, so app code owns this deletion.
function deleteOrphanCaches(): void {
  if (typeof caches === 'undefined') return;
  caches.delete('binnacle-pmtiles').catch(() => {
    // Best-effort: a failure leaves a dead cache behind, nothing more.
  });
}

const RELOAD_GUARD_KEY = 'binnacle:pwa-reload-at';
// One post-update reload per window is the legitimate maximum. Anything faster is a reload storm.
export const PWA_RELOAD_GUARD_MS = 30_000;

// The library's default is an unconditional window.location.reload() whenever the controlling
// service worker changes. A pathological environment (a proxy or extension mutating the worker
// script per fetch, or repeated external activations) turns that into an infinite reload storm
// that cancels its own navigations, leaves the page unable to settle, and cannot be escaped from
// the UI. This guard makes the reload single-shot per guard window: the first controller change
// reloads as before, and any further change inside the window logs and leaves the Update control
// to the navigator instead of reloading. sessionStorage scopes the guard to the tab and survives
// the reload itself.
export function guardedReload(
  now: () => number = Date.now,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof sessionStorage === 'undefined'
    ? undefined
    : sessionStorage,
  reload: () => void = () => window.location.reload(),
): void {
  let last = Number.NaN;
  try {
    // An absent key must stay NaN: Number(null) is 0, which would read as a reload at epoch zero
    // and wrongly suppress the first legitimate reload.
    const raw = storage?.getItem(RELOAD_GUARD_KEY);
    if (raw !== null && raw !== undefined && raw !== '') last = Number(raw);
  } catch {
    // Storage can throw in degraded contexts; treat it as no prior reload.
  }
  const at = now();
  if (Number.isFinite(last) && at - last < PWA_RELOAD_GUARD_MS) {
    console.warn(
      '[pwa] a second service-worker controller change arrived within the reload guard window; suppressing the automatic reload. Use the Update control to apply the new version.',
    );
    return;
  }
  try {
    storage?.setItem(RELOAD_GUARD_KEY, String(at));
  } catch {
    // If the timestamp cannot persist the guard degrades to reload-always, the old behavior.
  }
  reload();
}

// Registers the service worker (prompt mode). onNeedRefresh fires when a new build is waiting so the
// UI can offer a reload, and update(true) activates it. On plain http (no secure context) registerSW
// no-ops, so this degrades cleanly. A registration error in a secure context is logged rather than
// swallowed, so a genuine HTTPS failure is observable instead of silently invisible.
export function registerPwa(onNeedRefresh?: () => void): PwaController {
  deleteOrphanCaches();
  // Ask the browser not to evict this origin's storage under pressure: the tile and chart caches
  // are the offline navigation data. Browsers may decline silently; that is fine.
  void navigator.storage?.persist?.().catch(() => undefined);
  const updateSW = registerSW({
    onNeedRefresh,
    onNeedReload: () => guardedReload(),
    onRegisterError: (error) => {
      // An untrusted server certificate makes the browser refuse to register a service worker, even
      // after the user clicks through the page warning, so offline caching stays off (the app itself
      // works fully). The match is a heuristic on the browser's non-standard error text; a miss just
      // falls through to the generic warning below.
      const message = error instanceof Error ? error.message : String(error);
      if (/certificate|ssl/i.test(message)) {
        console.info(
          '[pwa] Offline caching is off: this browser does not trust the server certificate. Install the Signal K server certificate as a trusted root to enable offline use.',
        );
        return;
      }
      console.warn('[pwa] service worker registration failed', error);
    },
  });
  return { update: () => void updateSW(true) };
}

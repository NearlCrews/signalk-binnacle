import { getSerwist } from 'virtual:serwist';
import type { Serwist } from '@serwist/window';

// The registration outcome, surfaced so the offline charts page can explain a cache that stays
// off instead of leaving the diagnosis in devtools: 'insecure-context' when the browser withholds
// the service worker API (plain http), 'untrusted-certificate' when registration was refused over
// the server certificate, 'failed' on any other registration error.
export type PwaStatus =
  | 'pending'
  | 'insecure-context'
  | 'active'
  | 'untrusted-certificate'
  | 'failed';

export interface PwaController {
  update: () => void;
  readonly status: PwaStatus;
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
// One automatic post-update reload per window is the legitimate maximum. Anything faster is a
// reload storm.
export const PWA_RELOAD_GUARD_MS = 30_000;

export interface ReloadCoordinator {
  /** The post-update reload hook: automatic controller changes pass the guard, user requests bypass it. */
  onNeedReload: () => void;
  /** The Update control: activates the waiting worker, or reloads directly after a suppressed reload. */
  requestUpdate: (activate: () => void) => void;
}

// The library's default is an unconditional window.location.reload() whenever the controlling
// service worker changes. A pathological environment (a proxy or extension mutating the worker
// script per fetch, or repeated external activations) turns that into an infinite reload storm
// that cancels its own navigations, leaves the page unable to settle, and cannot be escaped from
// the UI. The coordinator makes the AUTOMATIC reload single-shot per guard window while keeping
// the navigator in charge: an explicit Update click is consent and always reloads, and a click
// that arrives after a suppressed reload (the worker already activated, so nothing is waiting)
// reloads directly instead of silently doing nothing. sessionStorage scopes the guard to the tab
// and survives the reload itself.
export function createReloadCoordinator(
  now: () => number = Date.now,
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined = typeof sessionStorage ===
  'undefined'
    ? undefined
    : sessionStorage,
  reload: () => void = () => window.location.reload(),
): ReloadCoordinator {
  // Timestamp of an Update click whose controller change has not landed yet: that reload is
  // consented and bypasses the guard. The consent expires after the guard window, so a click
  // whose activation never happened (nothing was waiting) cannot let a much later automatic
  // controller change slip past the storm guard.
  let userRequestedAt: number | null = null;
  // True once an automatic reload was suppressed: the new worker is already controlling, so the
  // next Update click must reload directly rather than message a waiting worker that is gone.
  let suppressed = false;

  const doReload = (at: number): void => {
    try {
      storage?.setItem(RELOAD_GUARD_KEY, String(at));
    } catch {
      // If the timestamp cannot persist the guard degrades to reload-always, the old behavior.
    }
    reload();
  };

  return {
    onNeedReload() {
      const at = now();
      if (userRequestedAt !== null) {
        const consented = at - userRequestedAt <= PWA_RELOAD_GUARD_MS;
        userRequestedAt = null;
        if (consented) {
          doReload(at);
          return;
        }
      }
      let last = Number.NaN;
      try {
        // An absent key must stay NaN: Number(null) is 0, which would read as a reload at epoch
        // zero and wrongly suppress the first legitimate reload.
        const raw = storage?.getItem(RELOAD_GUARD_KEY);
        if (raw !== null && raw !== undefined && raw !== '') last = Number(raw);
      } catch {
        // Storage can throw in degraded contexts; treat it as no prior reload.
      }
      if (Number.isFinite(last) && at - last < PWA_RELOAD_GUARD_MS) {
        suppressed = true;
        console.warn(
          '[pwa] a second service-worker controller change arrived within the reload guard window; suppressing the automatic reload. Use the Update control to apply the new version.',
        );
        return;
      }
      doReload(at);
    },
    requestUpdate(activate) {
      if (suppressed) {
        suppressed = false;
        doReload(now());
        return;
      }
      userRequestedAt = now();
      activate();
    },
  };
}

// Registers the service worker (prompt mode). onNeedRefresh fires when a new build is waiting so
// the UI can offer a reload, and update() activates it by messaging the waiting worker. On plain
// http (no secure context) the serviceWorker API is absent and registration is never attempted, so
// this degrades cleanly. A registration error in a secure context is logged and surfaced through
// the reactive status, so a genuine HTTPS failure is observable instead of silently invisible.
export function registerPwa(
  onNeedRefresh?: () => void,
  coordinator: ReloadCoordinator = createReloadCoordinator(),
): PwaController {
  deleteOrphanCaches();
  // Ask the browser not to evict this origin's storage under pressure: the tile and chart caches
  // are the offline navigation data. Browsers may decline silently; that is fine. Guarded like
  // the status classification below, so both survive an environment without a navigator.
  if (typeof navigator !== 'undefined') {
    void navigator.storage?.persist?.().catch(() => undefined);
  }
  // Over plain http the serviceWorker API is absent, so registration is never attempted and no
  // listener below ever fires; classify that up front rather than leaving the status pending.
  let status = $state<PwaStatus>(
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      ? 'pending'
      : 'insecure-context',
  );
  let serwist: Serwist | undefined;
  // The dev server bundles the worker without a precache manifest, so registering it would fail
  // where the old tooling was a silent no-op; skip in dev only (vitest runs under mode 'test').
  // The status then stays 'pending' for the whole dev session, which the offline charts page
  // deliberately renders without a cache-off note.
  const ready =
    import.meta.env.MODE === 'development'
      ? Promise.resolve()
      : (async () => {
          try {
            // Inside the try on purpose: getSerwist() lazily imports a real chunk, and a failed
            // fetch of it must classify below rather than escape as an unhandled rejection that
            // leaves the status pending and the offline charts page looking healthy.
            const instance = await getSerwist();
            // Undefined means the serviceWorker API is withheld; status is already
            // insecure-context.
            if (!instance) return;
            serwist = instance;
            // Distinguishes a first install (no controller existed when this page loaded) from a
            // later spontaneous discard, so only a failed first install downgrades the status.
            const hadController = Boolean(navigator.serviceWorker?.controller);
            let sawWaiting = false;
            let installed = false;
            // Listeners attach before register() so a worker that was already waiting (its
            // 'waiting' replays on a microtask after register resolves) cannot be missed.
            instance.addEventListener('waiting', () => {
              sawWaiting = true;
              installed = true;
              onNeedRefresh?.();
            });
            instance.addEventListener('controlling', (event) => {
              installed = true;
              // Reload when an update or an external activation takes control, and also when a
              // waiting worker was surfaced first: the library computes isUpdate once at
              // registration, so on a first-visit tab a later same-session update arrives with
              // isUpdate false even after a consented Update click. The one silent case is the
              // very first install taking control under clientsClaim (no prior waiting, not an
              // update, not external); reloading a first visit would be wrong.
              if (event.isUpdate || event.isExternal || sawWaiting) coordinator.onNeedReload();
            });
            instance.addEventListener('redundant', () => {
              // A first install that gets discarded before ever taking control means the precache
              // failed and offline caching is off, even though registration itself succeeded.
              if (!installed && !hadController) {
                status = 'failed';
                console.warn(
                  '[pwa] the service worker was discarded before taking control; offline caching is off.',
                );
              }
            });
            await instance.register();
            status = 'active';
          } catch (error) {
            // An untrusted server certificate makes the browser refuse to register a service
            // worker, even after the user clicks through the page warning, so offline caching
            // stays off (the app itself works fully). The match is a heuristic on the browser's
            // non-standard error text; a miss just falls through to the generic warning below.
            const message = error instanceof Error ? error.message : String(error);
            if (/certificate|ssl/i.test(message)) {
              status = 'untrusted-certificate';
              console.info(
                '[pwa] Offline caching is off: this browser does not trust the server certificate. Install the Signal K server certificate as a trusted root to enable offline use.',
              );
              return;
            }
            status = 'failed';
            console.warn('[pwa] service worker registration failed', error);
          }
        })();
  return {
    // A click that lands before registration settles defers behind the ready promise instead of
    // being dropped; messageSkipWaiting() then no-ops if nothing is waiting, and the
    // coordinator's suppressed path still covers the reload-directly case.
    update: () =>
      coordinator.requestUpdate(() => void ready.then(() => serwist?.messageSkipWaiting())),
    get status() {
      return status;
    },
  };
}

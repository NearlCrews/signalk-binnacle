import type * as maplibregl from 'maplibre-gl';
import type { OverlayContext } from './types';

// How often store-driven overlays (AIS prune, tides, radar advance, collision) are synced when the
// map is not repainting on its own. Map moves still sync on every 'render', so this only covers the
// overlays that change without a camera move; 250 ms is well under the radar frame dwell.
const STORE_SYNC_MS = 250;

// Anything the overlay sync can drive: the overlay modules all expose sync(ctx).
export interface Syncable {
  sync(ctx: OverlayContext): void;
}

export type OverlaySyncStatus = (overlayId: string | undefined, error: unknown | undefined) => void;

function syncableId(overlay: Syncable): string | undefined {
  return 'id' in overlay && typeof overlay.id === 'string' ? overlay.id : undefined;
}

export interface OverlayTick {
  // Start syncing the overlays: on every MapLibre 'render' (so pan and zoom repaints update them)
  // and on a low-frequency interval (so store-driven overlays that change without a camera move,
  // like AIS prune, tides, radar advance, and collision, still tick). Both stop while the document
  // is hidden. The per-overlay dirty-checks still gate real work, so this only changes WHEN sync is
  // invoked, not what it does.
  runTick: (overlays: ReadonlyArray<Syncable>, onStatus?: OverlaySyncStatus) => void;
  // Teardown for the sync wiring runTick installs (the 'render' listener, the interval, and the
  // visibilitychange listener). A no-op until runTick is called; invoked once on destroy.
  stopTick: () => void;
}

export function createOverlayTick(
  map: maplibregl.Map,
  ctx: OverlayContext,
  isDestroyed: () => boolean,
): OverlayTick {
  // The live teardown for the current runTick wiring. A no-op until runTick is called, then the real
  // teardown, then a no-op again once it has run. runTick reassigns this, so the returned stopTick
  // delegates through it rather than capturing a stale value.
  let teardown = () => {};

  const runTick = (overlays: ReadonlyArray<Syncable>, onStatus?: OverlaySyncStatus) => {
    // A second call must not orphan the first 'render' listener, interval, and visibilitychange
    // listener, so tear down any prior wiring first.
    teardown();
    // An async widget initializer can reach runTick after the map owner has already torn down. Do
    // not reinstall listeners or timers on the dead map in that case.
    if (isDestroyed()) return;
    // Calling this once replaces the old unconditional rAF loop, which synced ~60x/sec for the life
    // of the map even at anchor. Now sync runs only when the map actually repaints (pan, zoom) and
    // on a low-frequency interval for the store-driven overlays, and both pause while hidden.
    const failedOverlays = new WeakSet<Syncable>();
    const syncAll = () => {
      if (isDestroyed()) return;
      for (const overlay of overlays) {
        if (isDestroyed()) return;
        try {
          overlay.sync(ctx);
          if (failedOverlays.delete(overlay)) onStatus?.(syncableId(overlay), undefined);
        } catch (error) {
          // A broken optional overlay must never prevent later navigation overlays from updating.
          // Warn once per continuous failure so the 250 ms safety tick does not flood the console.
          if (!failedOverlays.has(overlay)) {
            const id = syncableId(overlay);
            console.warn(`Overlay "${id ?? 'unmanaged'}" failed to synchronize.`, error);
            failedOverlays.add(overlay);
            onStatus?.(id, error);
          }
        }
      }
    };

    // MapLibre fires 'render' only when it repaints, so this covers every pan and zoom without a
    // self-scheduling frame loop.
    map.on('render', syncAll);

    let interval = 0;
    const startInterval = () => {
      if (interval) return;
      interval = window.setInterval(syncAll, STORE_SYNC_MS);
    };
    const stopInterval = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = 0;
    };

    // Pause both the interval and (implicitly, since the map stops repainting) the render sync while
    // the tab is hidden; resume and sync once on return so a hidden-tab change shows immediately.
    const onVisibility = () => {
      if (document.hidden) {
        stopInterval();
      } else {
        startInterval();
        syncAll();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) startInterval();
    syncAll();

    teardown = () => {
      map.off('render', syncAll);
      stopInterval();
      document.removeEventListener('visibilitychange', onVisibility);
      teardown = () => {};
    };
  };

  return {
    runTick,
    stopTick: () => teardown(),
  };
}

import type { TideStation, TideStationKind, TidesStore } from '$entities/tides';
import { MINUTE_MS } from '$shared/lib';
import { haversineMeters } from '$shared/nav';
import type { TidesLoader } from './tides-loader';

export interface TidesView {
  lat: number;
  lon: number;
}

export interface TidesController {
  start(): void;
  stop(): void;
  load(view: TidesView, force?: boolean): Promise<void>;
  loadCurrent(force?: boolean): Promise<void>;
  selectStation(kind: TideStationKind, station: TideStation): Promise<void>;
  useAutomatic(kind: TideStationKind): Promise<void>;
  useNearestStations(): Promise<void>;
  retry(): Promise<void>;
}

interface TidesRefreshDeps {
  wanted: () => boolean;
  online: () => boolean;
  token: () => string | undefined;
  now?: () => number;
  visible?: () => boolean;
}

const REFRESH_MS = 5 * MINUTE_MS;

// Owns every tide load entry point so pans, panel controls, retries, and chart-marker selections all
// take the same selection snapshot and force/cooldown path.
export function createTidesController(
  store: TidesStore,
  loader: TidesLoader,
  getView: () => TidesView | undefined,
  refresh?: TidesRefreshDeps,
): TidesController {
  const now = refresh?.now ?? Date.now;
  let lastCompletedAt = Number.NEGATIVE_INFINITY;
  let pending = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastToken: string | undefined;
  let tokenKnown = false;
  let wasWanted = false;
  const load = async (view: TidesView, force = false): Promise<void> => {
    if (refresh) {
      lastToken = refresh.token();
      tokenKnown = true;
    }
    pending += 1;
    try {
      await loader.load(store, view.lat, view.lon, force);
    } finally {
      pending -= 1;
      lastCompletedAt = now();
    }
  };

  const loadCurrent = (force = false): Promise<void> => {
    const view = getView();
    return view ? load(view, force) : Promise.resolve();
  };

  function checkRefresh(): void {
    if (!refresh || timer === undefined) return;
    const wanted = refresh.wanted();
    const newlyWanted = wanted && !wasWanted;
    wasWanted = wanted;
    if (
      !wanted ||
      !refresh.online() ||
      !(refresh.visible?.() ?? (typeof document === 'undefined' || !document.hidden)) ||
      pending > 0
    )
      return;
    const token = refresh.token();
    const changedToken = tokenKnown && token !== lastToken;
    tokenKnown = true;
    lastToken = token;
    if (!newlyWanted && !changedToken && now() - lastCompletedAt < REFRESH_MS) return;
    // Ordinary checks retain the loader's cache and cooldown. A newly approved credential is
    // deliberate new access context, so it gets one immediate attempt instead of a failed cache.
    void loadCurrent(changedToken).catch(() => undefined);
  }

  function start(): void {
    if (!refresh || timer !== undefined) return;
    timer = setInterval(checkRefresh, MINUTE_MS);
    if (typeof window !== 'undefined') window.addEventListener('focus', checkRefresh);
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', checkRefresh);
    checkRefresh();
  }

  function stop(): void {
    clearInterval(timer);
    timer = undefined;
    if (typeof window !== 'undefined') window.removeEventListener('focus', checkRefresh);
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', checkRefresh);
  }

  return {
    start,
    stop,
    load,
    loadCurrent,
    selectStation(kind, station) {
      const view = getView();
      const distanceMeters = view
        ? haversineMeters(view.lat, view.lon, station.latitude, station.longitude)
        : 0;
      store.requestManual(kind, station, distanceMeters);
      return loadCurrent(true);
    },
    useAutomatic(kind) {
      store.requestAutomatic(kind);
      return loadCurrent(true);
    },
    useNearestStations() {
      store.requestAllAutomatic();
      return loadCurrent(true);
    },
    retry() {
      return loadCurrent(true);
    },
  };
}

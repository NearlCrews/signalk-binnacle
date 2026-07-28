import type { TideStation, TideStationKind, TidesStore } from '$entities/tides';
import { haversineMeters } from '$shared/nav';
import type { TidesLoader } from './tides-loader';

export interface TidesView {
  lat: number;
  lon: number;
}

export interface TidesController {
  load(view: TidesView, force?: boolean): Promise<void>;
  loadCurrent(force?: boolean): Promise<void>;
  selectStation(kind: TideStationKind, station: TideStation): Promise<void>;
  useAutomatic(kind: TideStationKind): Promise<void>;
  useNearestStations(): Promise<void>;
  retry(): Promise<void>;
}

// Owns every tide load entry point so pans, panel controls, retries, and chart-marker selections all
// take the same selection snapshot and force/cooldown path.
export function createTidesController(
  store: TidesStore,
  loader: TidesLoader,
  getView: () => TidesView | undefined,
): TidesController {
  const load = (view: TidesView, force = false): Promise<void> =>
    loader.load(store, view.lat, view.lon, force);

  const loadCurrent = (force = false): Promise<void> => {
    const view = getView();
    return view ? load(view, force) : Promise.resolve();
  };

  return {
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

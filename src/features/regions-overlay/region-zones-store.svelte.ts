import { fetchRegionZones, type RegionZone } from './region-zones-client';

export type RegionZonesLoadState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

export interface RegionZonesStore {
  readonly state: RegionZonesLoadState;
  readonly regions: readonly RegionZone[];
  // First call kicks the load; later calls retry only after a failed load with nothing to show.
  // The overlay calls this when the layer turns visible, so a session that never shows regions
  // never fetches them.
  ensureLoaded(): Promise<void>;
  // Refetch after a reconnect, keeping shown zones through a transient failure. A no-op until
  // something has asked for the zones via ensureLoaded.
  refresh(): Promise<void>;
}

interface RegionZonesStoreDeps {
  origin: string;
  // A getter, not a value: auth resolves after construction on a secured server, and a captured
  // token would freeze at undefined.
  getToken: () => string | undefined;
}

export function createRegionZonesStore(deps: RegionZonesStoreDeps): RegionZonesStore {
  let state = $state<RegionZonesLoadState>('idle');
  let regions = $state<readonly RegionZone[]>([]);
  let requested = false;
  let generation = 0;

  async function load(): Promise<void> {
    const mine = ++generation;
    // A refresh of already-shown zones stays 'ready' so the retained data is not reported as a
    // fresh load in flight.
    if (state !== 'ready') state = 'loading';
    const result = await fetchRegionZones(deps.origin, deps.getToken());
    if (mine !== generation) return;
    if (result.state === 'ok') {
      regions = result.regions;
      state = 'ready';
    } else if (result.state === 'unavailable') {
      regions = [];
      state = 'unavailable';
    } else if (regions.length > 0) {
      state = 'ready';
    } else {
      state = 'error';
    }
  }

  return {
    get state() {
      return state;
    },
    get regions() {
      return regions;
    },
    ensureLoaded() {
      requested = true;
      if (state !== 'idle' && state !== 'error') return Promise.resolve();
      return load();
    },
    refresh() {
      if (!requested) return Promise.resolve();
      return load();
    },
  };
}

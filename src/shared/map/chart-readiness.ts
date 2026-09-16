import type { ErrorEvent, Map as MapLibreMap, MapSourceDataEvent } from 'maplibre-gl';

export type ChartReadiness = 'loading' | 'ready' | 'error' | 'empty';

// MapLibre 6.10's public isSourceLoaded() treats errored and empty tiles as loaded. Keep this
// version-sensitive renderer adapter in one place: the current tile manager, not a history of
// successful requests, tells us whether this viewport contains drawable chart data. Missing
// methods fail closed. Verify this adapter when updating MapLibre.
function viewportReadiness(map: MapLibreMap, sourceId: string): ChartReadiness {
  const manager = map.style?.tileManagers?.[sourceId];
  if (!manager?.getIds || !manager.getTileByID || !manager.getRenderableIds) return 'loading';
  const tiles = manager.getIds().map((id) => manager.getTileByID(id));
  if (tiles.some((tile) => tile?.state === 'errored')) return 'error';
  if (
    tiles.length === 0 ||
    tiles.some((tile) => !tile || tile.state === 'loading' || tile.state === 'reloading')
  )
    return 'loading';
  const drawable = manager.getRenderableIds().some((id) => {
    const tile = manager.getTileByID(id);
    // hasData() only tests Tile.state. A loaded but empty vector tile has no drawn buckets.
    return tile && (tile.texture || Object.keys(tile.buckets ?? {}).length > 0);
  });
  return drawable ? 'ready' : 'empty';
}

export function createChartReadinessTracker(map: MapLibreMap, onChange: () => void) {
  const watched = new Map<string, ChartReadiness>();
  const metadataFailures = new Map<string, unknown>();
  const read = (id: string): ChartReadiness => {
    const source = map.getSource(id);
    if (!source) return 'loading';
    if (metadataFailures.has(id) && metadataFailures.get(id) === source) return 'error';
    return viewportReadiness(map, id);
  };
  const notify = (): void => {
    let changed = false;
    for (const [id, prior] of watched) {
      const next = read(id);
      if (next !== prior) {
        watched.set(id, next);
        changed = true;
      }
    }
    if (changed) onChange();
  };
  const data = (event: MapSourceDataEvent): void => {
    if (event.sourceDataType === 'metadata') metadataFailures.delete(event.sourceId);
    notify();
  };
  const error = (event: ErrorEvent & { sourceId?: string; tile?: unknown }): void => {
    if (event.sourceId && !event.tile)
      metadataFailures.set(event.sourceId, map.getSource(event.sourceId));
    notify();
  };
  const reset = (): void => {
    metadataFailures.clear();
    notify();
  };
  map.on('sourcedataloading', notify);
  map.on('sourcedata', data);
  map.on('error', error);
  map.on('render', notify);
  map.on('idle', notify);
  map.on('style.load', reset);
  return {
    getState(sourceIds: readonly string[] | undefined): ChartReadiness {
      if (!sourceIds?.length) return 'loading';
      const states = sourceIds.map((id) => {
        const state = read(id);
        watched.set(id, state);
        return state;
      });
      if (states.some((state) => state === 'error')) return 'error';
      if (states.some((state) => state === 'loading')) return 'loading';
      return states.some((state) => state === 'ready') ? 'ready' : 'empty';
    },
    destroy(): void {
      map.off('sourcedataloading', notify);
      map.off('sourcedata', data);
      map.off('error', error);
      map.off('render', notify);
      map.off('idle', notify);
      map.off('style.load', reset);
      watched.clear();
      metadataFailures.clear();
    },
  };
}

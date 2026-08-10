import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  ensureGeoJsonSources,
  featureCollection,
  removeLayersAndSources,
  setSourceData,
} from '$shared/map';

// The read-only highlight for the route-coverage check: the corridor's uncovered runs in the
// danger red and the insufficient-detail runs in the warning amber, dashed over the chart. Panel-
// scoped like the Terra Draw rectangle (created when a check runs, destroyed with the Offline
// charts panel), never a Layers-panel row, and never interactive. The two colors are fixed alarm
// hues, distinguishable on every theme including night-red, where a coverage gap is safety
// information and keeps its warning color.

const SRC = 'binnacle-route-coverage';
const LAYER = 'binnacle-route-coverage-line';
const UNCOVERED_COLOR = '#ff4d4d';
const DETAIL_COLOR = '#ffb020';

export interface CoverageHighlight {
  set(gaps: GeoJSON.Feature[]): void;
  clear(): void;
  destroy(): void;
}

export function createCoverageHighlight(map: MapLibreMap): CoverageHighlight {
  ensureGeoJsonSources(map, [SRC]);
  if (!map.getLayer(LAYER)) {
    map.addLayer({
      id: LAYER,
      type: 'line',
      source: SRC,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['==', ['get', 'kind'], 'uncovered'], UNCOVERED_COLOR, DETAIL_COLOR],
        'line-width': 6,
        'line-opacity': 0.8,
        'line-dasharray': [1, 1.2],
      },
    });
  }
  return {
    set(gaps) {
      setSourceData(map, SRC, featureCollection(gaps));
    },
    clear() {
      setSourceData(map, SRC, featureCollection([]));
    },
    destroy() {
      removeLayersAndSources(map, [LAYER], [SRC]);
    },
  };
}

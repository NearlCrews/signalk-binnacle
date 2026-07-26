import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { categoryRank, POI_CATEGORIES, poiIconId } from '$entities/poi-icons';
import {
  DARK_SCRIM,
  emptyFeatureCollection,
  ensureGeoJsonSource,
  type MapThemePaint,
  removeLayersAndSources,
  rgbaCss,
} from '$shared/map';

export const SOURCE_ID = 'binnacle-notes';
export const LAYER_ID = 'binnacle-notes-symbol';
// A cluster is a group ring, the most important member's colored icon, and a count badge.
export const CLUSTER_RING_LAYER = 'binnacle-notes-cluster-ring';
export const CLUSTER_ICON_LAYER = 'binnacle-notes-cluster-icon';
export const CLUSTER_COUNT_LAYER = 'binnacle-notes-cluster-count';
export const SELECT_SOURCE = 'binnacle-notes-selected-source';
export const SELECT_LAYER = 'binnacle-notes-selected';
export const SELECT_CASING_LAYER = 'binnacle-notes-selected-casing';
// A fixed dark casing under the amber selection ring, so it holds on light day water; invisible on the
// dark themes where the ring carries on its own. The shared DARK_SCRIM, as the route line uses.
const SELECT_CASING_COLOR = rgbaCss(DARK_SCRIM);
// The note layers, bottom to top, in one place for layerIds, setVisible, and remove.
export const LAYERS = [
  SELECT_CASING_LAYER,
  SELECT_LAYER,
  CLUSTER_RING_LAYER,
  CLUSTER_ICON_LAYER,
  CLUSTER_COUNT_LAYER,
  LAYER_ID,
];
// The cluster layers that respond to a click (expand) and a hover (pointer cursor).
export const CLUSTER_HIT_LAYERS = [CLUSTER_ICON_LAYER, CLUSTER_RING_LAYER];
// The cluster ring's base stroke opacity, shared by the layer spec and the overlay's setOpacity so
// the two cannot drift.
export const CLUSTER_RING_BASE_OPACITY = 0.9;
// Below this zoom the viewport spans too much to usefully fetch or show every POI.
export const MIN_ZOOM = 9;
// Past this zoom each point unclusters and shows its own icon. Clusters live at z9 to z11 so the
// wide view does not mash, and individual POIs appear from z12.
const CLUSTER_MAX_ZOOM = 11;
const CLUSTER_RADIUS = 44;

// The cluster icon: the colored disc of the cluster's highest-ranked member, matched on the
// aggregated maxRank, so a cluster holding a hazard shows the red hazard disc, a navaid the amber
// disc, otherwise the POI disc. Distinct ranks make the match labels unique; generic is the default.
const CLUSTER_ICON_IMAGE = [
  'match',
  ['get', 'maxRank'],
  ...POI_CATEGORIES.filter((category) => category !== 'generic').flatMap((category) => [
    categoryRank(category),
    poiIconId(category),
  ]),
  poiIconId('generic'),
] as unknown as ExpressionSpecification;

// Build and add the six note layers (the selection casing and ring, the cluster ring, icon, and
// count, and the unclustered point layer) plus their two sources, each guarded so a re-add is a
// no-op. Inserted below `before` (the routes band anchor). Paint colors come from `themePaint`;
// render() later overrides the point layer's icon-offset per provided symbol.
export function addNoteLayers(
  map: MapLibreMap,
  themePaint: MapThemePaint,
  before: string | undefined,
): void {
  if (!map.getSource(SOURCE_ID)) {
    const source: GeoJSONSourceSpecification = {
      type: 'geojson',
      data: emptyFeatureCollection(),
      cluster: true,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterRadius: CLUSTER_RADIUS,
      // Carry the highest member rank up to the cluster so it can show that member's icon.
      clusterProperties: { maxRank: ['max', ['get', 'rank']] },
    };
    map.addSource(SOURCE_ID, source);
  }
  ensureGeoJsonSource(map, SELECT_SOURCE);

  // Selection ring sits below the markers so the icon draws on top of it; a dark casing ring below
  // it (a wider stroke at the same radius) gives the amber ring contrast on light day water.
  if (!map.getLayer(SELECT_CASING_LAYER)) {
    const selectCasing: CircleLayerSpecification = {
      id: SELECT_CASING_LAYER,
      type: 'circle',
      source: SELECT_SOURCE,
      minzoom: MIN_ZOOM,
      paint: {
        'circle-radius': 15,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': SELECT_CASING_COLOR,
        'circle-stroke-width': 5,
      },
    };
    map.addLayer(selectCasing, before);
  }
  if (!map.getLayer(SELECT_LAYER)) {
    const selectLayer: CircleLayerSpecification = {
      id: SELECT_LAYER,
      type: 'circle',
      source: SELECT_SOURCE,
      minzoom: MIN_ZOOM,
      paint: {
        'circle-radius': 15,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': themePaint.select,
        'circle-stroke-width': 3,
      },
    };
    map.addLayer(selectLayer, before);
  }

  // The group ring behind the cluster icon, so a cluster never reads as a single POI; its
  // radius steps up with the contained count.
  if (!map.getLayer(CLUSTER_RING_LAYER)) {
    const clusterRing: CircleLayerSpecification = {
      id: CLUSTER_RING_LAYER,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      minzoom: MIN_ZOOM,
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 18, 10, 22, 50, 28],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': themePaint.markerGlyph,
        'circle-stroke-width': 2.5,
        'circle-stroke-opacity': CLUSTER_RING_BASE_OPACITY,
      },
    };
    map.addLayer(clusterRing, before);
  }

  if (!map.getLayer(CLUSTER_ICON_LAYER)) {
    const clusterIcon: SymbolLayerSpecification = {
      id: CLUSTER_ICON_LAYER,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      minzoom: MIN_ZOOM,
      layout: {
        'icon-image': CLUSTER_ICON_IMAGE,
        'icon-size': 0.85,
        'icon-allow-overlap': true,
      },
    };
    map.addLayer(clusterIcon, before);
  }

  // The count badge at the upper-right corner, haloed so it reads over the icon and the ring.
  if (!map.getLayer(CLUSTER_COUNT_LAYER)) {
    const clusterCount: SymbolLayerSpecification = {
      id: CLUSTER_COUNT_LAYER,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['has', 'point_count'],
      minzoom: MIN_ZOOM,
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [1.2, -1.2],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': themePaint.markerGlyph,
        'text-halo-color': themePaint.note,
        'text-halo-width': 2.4,
      },
    };
    map.addLayer(clusterCount, before);
  }

  // Unclustered points: the per-category icon, with its name once zoomed in.
  if (!map.getLayer(LAYER_ID)) {
    const layer: SymbolLayerSpecification = {
      id: LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 0.9],
        // Default offset; render() sets a per-icon match via setLayoutProperty (a provided
        // symbol's offset pins its declared anchor pixel to the point). The offset cannot ride on
        // the feature as a ['get'], because MapLibre coerces an array-valued property to a string.
        'icon-offset': [0, 0],
        'icon-allow-overlap': true,
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
        'text-max-width': 9,
        'text-padding': 6,
      },
      paint: {
        'text-color': themePaint.note,
        'text-halo-color': themePaint.background,
        'text-halo-width': 1.2,
      },
      minzoom: MIN_ZOOM,
    };
    map.addLayer(layer, before);
  }
}

// Remove the six note layers and both note sources.
export function removeNoteLayers(map: MapLibreMap): void {
  removeLayersAndSources(map, LAYERS, [SOURCE_ID, SELECT_SOURCE]);
}

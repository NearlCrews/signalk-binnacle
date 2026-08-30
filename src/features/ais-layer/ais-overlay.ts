import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { AisTargets } from '$entities/ais';
import type { Assessment } from '$entities/collision';
import {
  createLayerHitHandlers,
  createSymbolOverlay,
  emptyFeatureCollection,
  featureCollection,
  type LayerHitEvent,
  mapThemePaint,
  type OverlayContext,
  overlayInteractive,
  type Rgba,
  removeLayersAndSources,
  type SymbolOverlay,
  setLayersVisibility,
  setMapImage,
  setSourceData,
} from '$shared/map';
import {
  AIS_ICON_ID,
  ATON_ICON_ID,
  ATON_VIRTUAL_ICON_ID,
  aisIconImage,
  atonIconImage,
  atonVirtualIconImage,
  SAR_ICON_ID,
  sarIconImage,
} from './ais-icon';
import { createAisRefreshGate } from './ais-refresh';
import { CLEAR_RANK, createSeverityTracker, WARNING_RANK } from './ais-severity';
import { AIS_SEVERITY_RANK_PROP, createAisSourceDiffer, targetFeature } from './ais-source-diff';

const SOURCE_ID = 'binnacle-ais';
const LAYER_ID = 'binnacle-ais-symbol';
const SELECTED_LAYER_ID = 'binnacle-ais-selected';
const LABEL_LAYER_ID = 'binnacle-ais-label';
const HIT_LAYER_ID = 'binnacle-ais-hit';
// The transient color shown for the single frame before the first recolor; taken from the day theme
// so there is one source for the day AIS color rather than a literal that could drift.
const DEFAULT_COLOR: Rgba = mapThemePaint('day').aisTarget;

// The map-wide global-state key carrying the selected target's context id. The label filter and
// sort key read it, because neither a filter nor a layout property can read feature-state, and a
// global-state write re-evaluates both without shipping any source data. Coalesced to '' (never a
// real id) so the comparison stays string-typed while nothing is selected.
const SELECTED_STATE_KEY = 'aisSelectedId';
const SELECTED_ID_MATCH: ExpressionSpecification = [
  '==',
  ['get', 'id'],
  ['coalesce', ['global-state', SELECTED_STATE_KEY], ''],
];

// Below this zoom an ungraded, unselected target shows only its icon: in a wide view the names are
// the clutter, and the placement engine would thin them by tile order rather than by threat. A
// graded (danger or warning) or selected target keeps its label at every zoom.
const LABEL_DECLUTTER_MIN_ZOOM = 9;

// An unnamed target gets no label rather than an empty collision box, and below the declutter zoom
// only a graded or selected target keeps one.
const LABEL_FILTER: ExpressionSpecification = [
  'all',
  ['!=', ['get', 'name'], ''],
  [
    'any',
    ['>=', ['zoom'], LABEL_DECLUTTER_MIN_ZOOM],
    ['<=', ['get', AIS_SEVERITY_RANK_PROP], WARNING_RANK],
    SELECTED_ID_MATCH,
  ],
];

// Text placement gives priority to lower sort keys, while overlapping always-on icons draw higher
// keys on top, so the two symbol layers need opposite orderings from the one rank: the label layer
// takes the rank as is (danger placed first, selected ahead of everything), and the icon layer
// inverts it so a danger triangle is never buried under clear traffic.
const LABEL_SORT_KEY: ExpressionSpecification = [
  'case',
  SELECTED_ID_MATCH,
  -1,
  ['get', AIS_SEVERITY_RANK_PROP],
];
const ICON_SORT_KEY: ExpressionSpecification = ['-', CLEAR_RANK, ['get', AIS_SEVERITY_RANK_PROP]];

// The selected ring is driven by feature-state, so selecting a target repaints without touching
// source data; every unselected target's ring stroke stays fully transparent.
function selectedStrokeOpacity(opacity: number): ExpressionSpecification {
  return ['case', ['boolean', ['feature-state', 'selected'], false], opacity, 0];
}

// The updateData counterpart of $shared/map's setSourceData: narrow the source handle once and
// no-op when the source is absent (the overlay was removed mid-flight).
function updateSourceData(
  map: MapLibreMap,
  sourceId: string,
  diff: Parameters<GeoJSONSource['updateData']>[0],
): void {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  void source?.updateData(diff);
}

// The kind-specific images beyond the vessel triangle the base overlay owns. Registered and
// recolored beside it, and matched per feature through the icon property below.
const EXTRA_ICONS: readonly { id: string; image: (color: Rgba) => ImageData }[] = [
  { id: ATON_ICON_ID, image: atonIconImage },
  { id: ATON_VIRTUAL_ICON_ID, image: atonVirtualIconImage },
  { id: SAR_ICON_ID, image: sarIconImage },
];

// Stale-target expiry lives on an app-level timer (store.pruneAis with the entities/ais TTL), never
// in this render path, which pauses in a hidden tab while the collision math keeps consuming the
// store. The interaction layer resolves every clicked id against that current entity view.
export interface AisOverlayOptions {
  onSelect?: (id: string) => void;
  selectedId?: () => string | undefined;
  now?: () => number;
  interactionsAllowed?: () => boolean;
  // The collision assessment, when the composition root wires it: grades drive label priority and
  // the low-zoom declutter. Absent, every target reads as clear and only selection keeps a label
  // below the declutter zoom.
  assessment?: () => Assessment;
}

export function createAisOverlay(
  targets: AisTargets,
  options: AisOverlayOptions = {},
): SymbolOverlay {
  const gate = createAisRefreshGate(targets, options.now ?? Date.now);
  const tracker = createSeverityTracker(options.assessment);
  const differ = createAisSourceDiffer();
  let visible = true;
  let opacity = 1;
  // The id whose feature-state currently carries selected: true, so a selection change clears the
  // old mark before setting the new one.
  let appliedSelectedId: string | undefined;
  const interactionsAllowed = (): boolean =>
    overlayInteractive(visible, opacity, options.interactionsAllowed);

  function buildFeatures(): GeoJSON.FeatureCollection {
    return featureCollection(
      targets.all().map((view) => targetFeature(view, tracker.rankFor(view.id))),
    );
  }

  // Selection is feature-state plus global-state, never source data: the ring repaints from the
  // state flag, and the label filter and sort key re-evaluate from the global id.
  function applySelection(ctx: OverlayContext): void {
    const selectedId = options.selectedId?.();
    if (selectedId === appliedSelectedId) return;
    if (appliedSelectedId !== undefined) {
      ctx.map.removeFeatureState({ source: SOURCE_ID, id: appliedSelectedId }, 'selected');
    }
    if (selectedId !== undefined) {
      ctx.map.setFeatureState({ source: SOURCE_ID, id: selectedId }, { selected: true });
    }
    ctx.map.setGlobalStateProperty(SELECTED_STATE_KEY, selectedId ?? null);
    appliedSelectedId = selectedId;
  }

  const hit = createLayerHitHandlers(
    HIT_LAYER_ID,
    (event: LayerHitEvent) => {
      for (const feature of event.features ?? []) {
        if (feature.geometry.type !== 'Point') continue;
        const id = feature.properties?.id;
        if (typeof id !== 'string' || !targets.find(id)) continue;
        options.onSelect?.(id);
        return true;
      }
      return false;
    },
    {
      band: 'traffic',
      interactionsAllowed,
    },
  );
  const base = createSymbolOverlay({
    id: 'ais',
    title: 'AIS targets',
    description: 'Vessels, navigation aids, and search-and-rescue aircraft broadcasting over AIS.',
    band: 'traffic',
    sourceId: SOURCE_ID,
    layerId: LAYER_ID,
    iconId: AIS_ICON_ID,
    iconImage: aisIconImage,
    defaultColor: DEFAULT_COLOR,
    paintColor: (paint) => paint.aisTarget,
    features: buildFeatures,
    // The sync below replaces the base repaint wholesale with the diff path, so the base gate must
    // never approve a paint of its own.
    shouldRefresh: () => false,
  });

  const syncVisibility = (ctx: OverlayContext): void => {
    setLayersVisibility(ctx.map, [SELECTED_LAYER_ID, LABEL_LAYER_ID], visible);
    setLayersVisibility(ctx.map, [HIT_LAYER_ID], visible && opacity > 0);
    hit.refreshInteractionState();
  };

  return {
    ...base,
    layerIds: [SELECTED_LAYER_ID, LAYER_ID, LABEL_LAYER_ID, HIT_LAYER_ID],
    async add(ctx) {
      // A fresh style holds none of the shipped features or selection state, so forget both and
      // let the first sync repaint in full.
      gate.reset();
      differ.reset();
      tracker.reset();
      appliedSelectedId = undefined;
      // Added ahead of the base (whose add only fills a missing source) to carry promoteId: the
      // diff path and feature-state both address features by the promoted context id.
      if (!ctx.map.getSource(SOURCE_ID)) {
        ctx.map.addSource(SOURCE_ID, {
          type: 'geojson',
          promoteId: 'id',
          data: emptyFeatureCollection(),
        });
      }
      await base.add(ctx);
      for (const { id, image } of EXTRA_ICONS) setMapImage(ctx.map, id, image(DEFAULT_COLOR));
      // The base overlay lays out a single image; each feature names its kind's icon instead.
      ctx.map.setLayoutProperty(LAYER_ID, 'icon-image', ['get', 'icon']);
      ctx.map.setLayoutProperty(LAYER_ID, 'symbol-sort-key', ICON_SORT_KEY);
      const before = ctx.beforeIdFor('traffic');
      if (!ctx.map.getLayer(SELECTED_LAYER_ID)) {
        const selectedLayer: CircleLayerSpecification = {
          id: SELECTED_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': 18,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': mapThemePaint('day').select,
            'circle-stroke-width': 3,
            'circle-stroke-opacity': selectedStrokeOpacity(1),
          },
        };
        ctx.map.addLayer(selectedLayer, LAYER_ID);
      }
      if (!ctx.map.getLayer(LABEL_LAYER_ID)) {
        const dayPaint = mapThemePaint('day');
        const labelLayer: SymbolLayerSpecification = {
          id: LABEL_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          filter: LABEL_FILTER,
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-max-width': 12,
            'symbol-sort-key': LABEL_SORT_KEY,
            // Overlap stays off on purpose: in a crowded anchorage the placement engine hides
            // colliding names instead of smearing them over each other and the icons. The sort key
            // makes that thinning deterministic, graded and selected names surviving first.
          },
          paint: {
            'text-color': dayPaint.label,
            'text-halo-color': dayPaint.background,
            'text-halo-width': 1.5,
          },
        };
        ctx.map.addLayer(labelLayer, before);
      }
      if (!ctx.map.getLayer(HIT_LAYER_ID)) {
        const hitLayer: CircleLayerSpecification = {
          id: HIT_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': 22,
            'circle-color': 'rgba(0,0,0,0)',
          },
        };
        ctx.map.addLayer(hitLayer, before);
      }
      hit.attach(ctx);
      syncVisibility(ctx);
    },
    sync(ctx) {
      applySelection(ctx);
      // A grading flip must not wait out the throttle window: a target turning danger re-sorts
      // and re-labels on this very pass.
      const gradingChanged = tracker.sync();
      if (!gate.shouldRefresh(gradingChanged)) return;
      const update = differ.next(targets.all(), tracker.rankFor);
      if (update.kind === 'none') return;
      if (update.kind === 'full') {
        setSourceData(ctx.map, SOURCE_ID, featureCollection(update.features));
        return;
      }
      updateSourceData(ctx.map, SOURCE_ID, update.diff);
      if (appliedSelectedId !== undefined) {
        const selected = appliedSelectedId;
        if (update.diff.remove?.includes(selected)) {
          // Explicitly dropped state for a pruned target, so the source's state map cannot grow a
          // stale entry; the re-add branch below restores it if the target returns still selected.
          ctx.map.removeFeatureState({ source: SOURCE_ID, id: selected }, 'selected');
        } else if (update.diff.add?.some((feature) => feature.properties?.id === selected)) {
          ctx.map.setFeatureState({ source: SOURCE_ID, id: selected }, { selected: true });
        }
      }
    },
    applyTheme(ctx, paint) {
      base.applyTheme?.(ctx, paint);
      for (const { id, image } of EXTRA_ICONS) setMapImage(ctx.map, id, image(paint.aisTarget));
      if (ctx.map.getLayer(SELECTED_LAYER_ID)) {
        ctx.map.setPaintProperty(SELECTED_LAYER_ID, 'circle-stroke-color', paint.select);
      }
      if (ctx.map.getLayer(LABEL_LAYER_ID)) {
        ctx.map.setPaintProperty(LABEL_LAYER_ID, 'text-color', paint.label);
        ctx.map.setPaintProperty(LABEL_LAYER_ID, 'text-halo-color', paint.background);
      }
    },
    setVisible(ctx, nextVisible) {
      visible = nextVisible;
      base.setVisible?.(ctx, nextVisible);
      syncVisibility(ctx);
    },
    setOpacity(ctx, nextOpacity) {
      opacity = nextOpacity;
      base.setOpacity?.(ctx, nextOpacity);
      if (ctx.map.getLayer(SELECTED_LAYER_ID)) {
        ctx.map.setPaintProperty(
          SELECTED_LAYER_ID,
          'circle-stroke-opacity',
          selectedStrokeOpacity(nextOpacity),
        );
      }
      if (ctx.map.getLayer(LABEL_LAYER_ID)) {
        ctx.map.setPaintProperty(LABEL_LAYER_ID, 'text-opacity', nextOpacity);
      }
      syncVisibility(ctx);
    },
    remove(ctx) {
      hit.detach(ctx);
      removeLayersAndSources(ctx.map, [HIT_LAYER_ID, LABEL_LAYER_ID, SELECTED_LAYER_ID], []);
      for (const { id } of EXTRA_ICONS) {
        if (ctx.map.hasImage(id)) ctx.map.removeImage(id);
      }
      base.remove(ctx);
    },
  };
}

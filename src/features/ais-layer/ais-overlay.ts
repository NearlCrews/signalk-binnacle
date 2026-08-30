import type { CircleLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
import type { AisTargets, AisTargetView } from '$entities/ais';
import { latLonToLonLat } from '$shared/geo';
import { headingDegrees } from '$shared/lib';
import {
  createLayerHitHandlers,
  createSymbolOverlay,
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

const SOURCE_ID = 'binnacle-ais';
const LAYER_ID = 'binnacle-ais-symbol';
const SELECTED_LAYER_ID = 'binnacle-ais-selected';
const LABEL_LAYER_ID = 'binnacle-ais-label';
const HIT_LAYER_ID = 'binnacle-ais-hit';
// The transient color shown for the single frame before the first recolor; taken from the day theme
// so there is one source for the day AIS color rather than a literal that could drift.
const DEFAULT_COLOR: Rgba = mapThemePaint('day').aisTarget;

// The kind-specific images beyond the vessel triangle the base overlay owns. Registered and
// recolored beside it, and matched per feature through the icon property below.
const EXTRA_ICONS: readonly { id: string; image: (color: Rgba) => ImageData }[] = [
  { id: ATON_ICON_ID, image: atonIconImage },
  { id: ATON_VIRTUAL_ICON_ID, image: atonVirtualIconImage },
  { id: SAR_ICON_ID, image: sarIconImage },
];

// Which registered image a target renders with: the triangle for vessels, a diamond for a
// navigation aid (hollow when the aid is virtual), and a cross for a SAR aircraft.
export function iconIdFor(target: AisTargetView): string {
  if (target.kind === 'aton') return target.virtual ? ATON_VIRTUAL_ICON_ID : ATON_ICON_ID;
  if (target.kind === 'sar') return SAR_ICON_ID;
  return AIS_ICON_ID;
}

// Stale-target expiry lives on an app-level timer (store.pruneAis with the entities/ais TTL), never
// in this render path, which pauses in a hidden tab while the collision math keeps consuming the
// store. The interaction layer resolves every clicked id against that current entity view.
export interface AisOverlayOptions {
  onSelect?: (id: string) => void;
  selectedId?: () => string | undefined;
  now?: () => number;
  interactionsAllowed?: () => boolean;
}

export function createAisOverlay(
  targets: AisTargets,
  options: AisOverlayOptions = {},
): SymbolOverlay {
  const gate = createAisRefreshGate(targets, options.now ?? Date.now);
  let visible = true;
  let opacity = 1;
  let lastSelectedId = options.selectedId?.();
  const interactionsAllowed = (): boolean =>
    overlayInteractive(visible, opacity, options.interactionsAllowed);

  function buildFeatures(): GeoJSON.FeatureCollection {
    const selectedId = options.selectedId?.();
    return featureCollection(
      targets.all().map((target) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: latLonToLonLat(target.position),
        },
        properties: {
          id: target.id,
          name: target.name ?? '',
          heading: headingDegrees(target.headingRad, target.cogRad),
          icon: iconIdFor(target),
          selected: target.id === selectedId,
        },
      })),
    );
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
    shouldRefresh: () => {
      const selectedId = options.selectedId?.();
      const selectionChanged = selectedId !== lastSelectedId;
      lastSelectedId = selectedId;
      // A selection change rebuilds the same source as an AIS update. Force the shared gate to
      // record that painted target list, or its stale count can throttle the next real count change.
      return gate.shouldRefresh(selectionChanged);
    },
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
      await base.add(ctx);
      for (const { id, image } of EXTRA_ICONS) setMapImage(ctx.map, id, image(DEFAULT_COLOR));
      // The base overlay lays out a single image; each feature names its kind's icon instead.
      ctx.map.setLayoutProperty(LAYER_ID, 'icon-image', ['get', 'icon']);
      const before = ctx.beforeIdFor('traffic');
      if (!ctx.map.getLayer(SELECTED_LAYER_ID)) {
        const selectedLayer: CircleLayerSpecification = {
          id: SELECTED_LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['==', ['get', 'selected'], true],
          paint: {
            'circle-radius': 18,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': mapThemePaint('day').select,
            'circle-stroke-width': 3,
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
          // An unnamed target gets no label rather than an empty collision box.
          filter: ['!=', ['get', 'name'], ''],
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-max-width': 12,
            // Overlap stays off on purpose: in a crowded anchorage the placement engine hides
            // colliding names instead of smearing them over each other and the icons.
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
        ctx.map.setPaintProperty(SELECTED_LAYER_ID, 'circle-stroke-opacity', nextOpacity);
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

import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { categoryForSkIcon, poiIconId, registerPoiIcons } from '$entities/poi-icons';
import { createOverlayIconResolver, type SymbolsStore } from '$entities/symbols';
import type { Waypoint, WaypointsStore } from '$entities/waypoint';
import { latLonToLonLat } from '$shared/geo';
import {
  ensureGeoJsonSource,
  featureCollection,
  iconOffsetExpression,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  type Syncable,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';

const SOURCE_ID = 'binnacle-waypoints';
const MARKER_LAYER = 'binnacle-waypoint-marker';
const SYMBOL_MARKER_LAYER = 'binnacle-waypoint-symbol';
const LABEL_LAYER = 'binnacle-waypoint-label';
const BAND = 'routes';

export interface WaypointOverlay extends OverlayModule, Syncable {}

// Standalone waypoints. Each waypoint renders as a provided symbol when its icon resolves to one
// (the Symbols API: an explicit `custom:`/`binnacle:` reference, or the `waypoint` built-in's
// override), otherwise as a small marker disc with its name beside it. A symbol-keyed feature
// carries `iconImage`; the disc layer and the symbol layer split the features by a filter, so the
// two never double up. Presentational only. The band matches the route overlay so the Layers panel
// lists it under My routes and tracks.
export function createWaypointOverlay(
  store: WaypointsStore,
  symbols?: SymbolsStore,
): WaypointOverlay {
  let paint: MapThemePaint = mapThemePaint('day');
  let lastVersion = -1;
  let mounted = false;
  let lifecycle = 0;
  let iconGeneration = 0;
  const layers = [MARKER_LAYER, SYMBOL_MARKER_LAYER, LABEL_LAYER];
  // Provided symbols (signalk-symbol-manager), absent on a stock server. The resolver owns the
  // per-overlay icon registry and the pending-symbol queue; a waypoint's icon resolves to a provided
  // symbol via the `waypoint` role, defaulting to the 'waypoint' built-in id so a `binnacle:waypoint`
  // override applies to every plain waypoint, or undefined for the built-in disc (no symbols store,
  // unresolvable reference, image still loading, or a failed load).
  const iconResolver = createOverlayIconResolver(symbols, (waypoint: Waypoint) =>
    symbols?.resolve(waypoint.icon ?? 'waypoint', 'waypoint'),
  );

  // Resolve a waypoint icon to a built-in POI map image id. "waypoint" (the default marker)
  // returns undefined so it keeps its circle disc. Bare ids and binnacle:/default: qualified ids
  // are classified via the same skIcon vocabulary the notes overlay uses; qualified foreign-
  // namespace ids are not built-ins and return undefined (let the icon resolver handle them).
  function builtinPoiIconId(icon: string | undefined): string | undefined {
    if (!icon || icon === 'waypoint') return undefined;
    const colon = icon.indexOf(':');
    let bareId = icon;
    if (colon !== -1) {
      const ns = icon.slice(0, colon);
      if (ns === 'binnacle' || ns === 'default') bareId = icon.slice(colon + 1);
      else return undefined;
    }
    return poiIconId(categoryForSkIcon(bareId));
  }

  function buildFeatures(waypoints: readonly Waypoint[]): {
    data: GeoJSON.FeatureCollection;
    iconOffset: ExpressionSpecification | [number, number];
  } {
    const offsets = new Map<string, readonly [number, number]>();
    const features = waypoints.map((waypoint): GeoJSON.Feature => {
      const entry = iconResolver.iconEntry(waypoint);
      if (entry && (entry.offset[0] !== 0 || entry.offset[1] !== 0)) {
        offsets.set(entry.iconId, entry.offset);
      }
      const builtinId = entry ? undefined : builtinPoiIconId(waypoint.icon);
      const iconImage = entry?.iconId ?? builtinId;
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: latLonToLonLat(waypoint.position),
        },
        properties: {
          name: waypoint.name,
          ...(iconImage ? { iconImage } : {}),
          // All icons in the symbol layer scale with zoom via the icon-size expression; property
          // presence is the flag (the literal value is not read by the expression).
          ...(iconImage ? { iconSize: 0.65 } : {}),
        },
      };
    });
    return {
      data: featureCollection(features),
      iconOffset: iconOffsetExpression('iconImage', offsets),
    };
  }

  function isCurrent(generation: number): boolean {
    return mounted && generation === lifecycle;
  }

  function redraw(ctx: OverlayContext, generation = lifecycle): void {
    if (!isCurrent(generation)) return;
    const { data, iconOffset } = buildFeatures(store.waypoints);
    setSourceData(ctx.map, SOURCE_ID, data);
    // The offset is a layer property (see iconOffsetExpression); restyle it each redraw.
    if (ctx.map.getLayer(SYMBOL_MARKER_LAYER)) {
      ctx.map.setLayoutProperty(SYMBOL_MARKER_LAYER, 'icon-offset', iconOffset);
    }
    ensurePendingIcons(ctx, generation);
  }

  // Kick the loads a render queued; each success redraws so the now-registered symbol replaces its
  // disc. A failure is remembered by the registry, so the disc simply stays.
  function ensurePendingIcons(ctx: OverlayContext, generation: number): void {
    iconResolver.ensurePending(ctx.map, paint, () => redraw(ctx, generation));
  }

  function registerBuiltInIcons(
    ctx: OverlayContext,
    nextPaint: MapThemePaint,
    generation: number,
  ): void {
    const icons = ++iconGeneration;
    const iconsAreCurrent = (): boolean => isCurrent(generation) && icons === iconGeneration;
    void registerPoiIcons(ctx.map, nextPaint, iconsAreCurrent).then(() => {
      if (iconsAreCurrent()) redraw(ctx, generation);
    });
  }

  // Invalidate the change-detection cache so the next sync repopulates from scratch. The manager
  // calls this on a base-style swap, which recreates the source empty; add() calls it so a fresh
  // add draws too.
  function reset(): void {
    mounted = false;
    lifecycle += 1;
    iconGeneration += 1;
    lastVersion = -1;
    iconResolver.invalidate();
  }

  return {
    id: 'waypoints',
    title: 'Waypoints',
    band: BAND,
    supportsOpacity: true,
    layerIds: layers,
    add(ctx) {
      const generation = ++lifecycle;
      mounted = true;
      lastVersion = -1;
      const before = ctx.beforeIdFor(BAND);
      ensureGeoJsonSource(ctx.map, SOURCE_ID);
      if (!ctx.map.getLayer(MARKER_LAYER)) {
        // The disc carries waypoints WITHOUT a provided symbol; the symbol layer carries the rest.
        const layer: CircleLayerSpecification = {
          id: MARKER_LAYER,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['!', ['has', 'iconImage']],
          paint: {
            'circle-radius': 5,
            'circle-color': paint.waypoint,
            'circle-stroke-color': paint.markerGlyph,
            'circle-stroke-width': 1.5,
          },
        };
        ctx.map.addLayer(layer, before);
      }
      if (!ctx.map.getLayer(SYMBOL_MARKER_LAYER)) {
        const layer: SymbolLayerSpecification = {
          id: SYMBOL_MARKER_LAYER,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['has', 'iconImage'],
          layout: {
            'icon-image': ['get', 'iconImage'],
            // Every icon-carrying feature (built-in POI icons and provided symbols alike) scales
            // with the shared marker zoom stops, matching the notes overlay; the nameless marker
            // discs stay at 1. iconOffsetExpression carries the same stops so provided-symbol
            // anchors stay pinned under MapLibre 6's unscaled icon-offset.
            // Camera expressions (zoom) must wrap data expressions, not the other way around.
            'icon-size': [
              'interpolate',
              ['linear'],
              ['zoom'],
              9,
              ['case', ['has', 'iconSize'], 0.6, 1],
              14,
              ['case', ['has', 'iconSize'], 0.9, 1],
            ],
            'icon-allow-overlap': true,
          },
        };
        ctx.map.addLayer(layer, before);
      }
      if (!ctx.map.getLayer(LABEL_LAYER)) {
        const layer: SymbolLayerSpecification = {
          id: LABEL_LAYER,
          type: 'symbol',
          source: SOURCE_ID,
          layout: {
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0.8, 0],
            'text-anchor': 'left',
            'text-optional': true,
            'text-max-width': 12,
          },
          paint: {
            'text-color': paint.label,
            'text-halo-color': paint.background,
            'text-halo-width': 1.5,
          },
        };
        ctx.map.addLayer(layer, before);
      }
      redraw(ctx, generation);
      registerBuiltInIcons(ctx, paint, generation);
    },
    reset,
    sync(ctx) {
      if (store.version === lastVersion) return;
      lastVersion = store.version;
      redraw(ctx);
    },
    setVisible(ctx, isVisible) {
      setLayersVisibility(ctx.map, layers, isVisible);
    },
    setOpacity(ctx, opacity) {
      ctx.map.setPaintProperty(MARKER_LAYER, 'circle-opacity', opacity);
      ctx.map.setPaintProperty(MARKER_LAYER, 'circle-stroke-opacity', opacity);
      ctx.map.setPaintProperty(SYMBOL_MARKER_LAYER, 'icon-opacity', opacity);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-opacity', opacity);
    },
    applyTheme(ctx, next) {
      paint = next;
      ctx.map.setPaintProperty(MARKER_LAYER, 'circle-color', paint.waypoint);
      ctx.map.setPaintProperty(MARKER_LAYER, 'circle-stroke-color', paint.markerGlyph);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-color', paint.label);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-halo-color', paint.background);
      // Re-raster registered symbols in place (same image ids), so the symbol layer updates.
      iconResolver.retheme(ctx.map, next);
      registerBuiltInIcons(ctx, next, lifecycle);
    },
    remove(ctx) {
      reset();
      removeLayersAndSources(ctx.map, layers, [SOURCE_ID]);
    },
  };
}

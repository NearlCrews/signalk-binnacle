import type {
  RasterLayerSpecification,
  RasterSourceSpecification,
  RasterTileSource,
} from 'maplibre-gl';
import type { WeatherStore } from '$entities/weather';
import { HOUR_MS, prefersReducedMotion } from '$shared/lib';
import {
  applyRasterTheme,
  type MapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
} from '$shared/map';
import { WEATHER_LAYER_IDS } from './fills';
import { frameTiles, TILE_SIZE } from './radar-frames';

const SOURCE_ID = 'binnacle-weather-radar';
const LAYER_ID = 'binnacle-weather-radar-layer';
const FRAME_MS = 600; // dwell on each past frame while looping
const PAUSE_MS = 1600; // hold on the latest frame before wrapping, so "now" reads clearly
const DEFAULT_OPACITY = 0.85; // one source for both the OverlayModule default and the initial paint

export interface RadarOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// RainViewer real-time precipitation radar as a themed raster overlay in the weather band. Off by
// default. It loops the past frames (oldest to newest, then a longer hold on the latest) so the rain
// is seen moving, unless a reduced-motion preference is set, in which case it holds on the latest
// frame. The loop is driven from the tick rather than its own timer, so it stops when the chart
// unmounts; `now` is injectable for tests. Night-red desaturates and dims the raster (it cannot be
// recolored), the same treatment the depth-charts rasters use.
//
// The source and layer are created lazily, only once a real frame exists, and removed nowhere except
// in remove(). A raster source's tiles cannot be a usable placeholder: an empty array crashes the
// tile-URL builder, and a data-URL tile fails to decode. So instead of a placeholder, the layer
// simply does not exist until there is a real frame to point it at. The desired visibility, opacity,
// and theme are tracked and applied when the layer is created or changed.
// Radar spans roughly the past two hours and may include a short nowcast. When the forecast scrubber
// is parked away from now, painting this recent timeline over a +72 h wind field
// would invite false correlation, so the layer hides itself until the slider returns. selectedTime
// of 0 means no grid has seeded the slider yet, which is not a scrub. ONE predicate, shared with
// the widget's legend note, so "hidden" in the legend and hidden on the map cannot disagree.
export function radarScrubbedAway(selectedTimeMs: number, nowMs: number): boolean {
  return selectedTimeMs !== 0 && Math.abs(selectedTimeMs - nowMs) > HOUR_MS;
}

type RadarFrameKind = 'observed' | 'nowcast';

export interface RadarFrameTiming {
  kind: RadarFrameKind;
  offsetMs: number;
  ageMs: number;
}

// RainViewer's useful default is recent radar history. Only a frame whose valid time is later than
// the current wall clock is a nowcast; current and older frames are observations with an age.
export function radarFrameTiming(frameTimeMs: number, nowMs: number): RadarFrameTiming {
  const offsetMs = frameTimeMs - nowMs;
  return {
    kind: offsetMs > 0 ? 'nowcast' : 'observed',
    offsetMs,
    ageMs: Math.max(0, -offsetMs),
  };
}

export function createRadarOverlay(
  store: WeatherStore,
  now: () => number = () => performance.now(),
  wallNow: () => number = () => Date.now(),
  // The painted frame's valid time, for the widget's legend note. A callback rather than a store
  // write-back, so a render-path overlay never mutates entities state.
  onFrameTime?: (timeMs: number) => void,
): RadarOverlay {
  let lastRadar: unknown;
  let frameIndex = 0;
  let lastAdvance = 0;
  let desiredVisible = false;
  let opacity = DEFAULT_OPACITY;
  let lastPaint: MapThemePaint | undefined;
  // One check at construction, matching the wind overlay: the preference is effectively fixed for
  // the session, and matchMedia on every visible sync tick is waste.
  const reducedMotion = prefersReducedMotion();

  // The single visibility truth for both the update path and lazy layer creation, so toggling the
  // layer on while the slider is scrubbed away can never flash live radar for a tick.
  function effectiveVisible(): boolean {
    return desiredVisible && !radarScrubbedAway(store.selectedTime, wallNow());
  }

  // MapLibre's setLayoutProperty already no-ops on an unchanged value, so no local cache.
  function applyEffectiveVisibility(ctx: OverlayContext): void {
    if (!ctx.map.getLayer(LAYER_ID)) return;
    ctx.map.setLayoutProperty(LAYER_ID, 'visibility', effectiveVisible() ? 'visible' : 'none');
  }

  // Point the source at the current frame, creating the source and layer the first time a frame is
  // available. A no-op when there is no radar data yet, so the layer never exists empty.
  function applyFrame(ctx: OverlayContext): void {
    const radar = store.radar;
    const frames = radar?.frames ?? [];
    if (!radar || frames.length === 0) return;
    const frame = frames[Math.min(frameIndex, frames.length - 1)];
    const url = frameTiles(radar.host, frame.path);
    // Surface the painted frame's valid time so the legend can say which moment the loop shows.
    onFrameTime?.(frame.time);

    const source = ctx.map.getSource(SOURCE_ID) as RasterTileSource | undefined;
    if (source) {
      source.setTiles([url]);
    } else {
      const spec: RasterSourceSpecification = {
        type: 'raster',
        tiles: [url],
        tileSize: TILE_SIZE,
        // RainViewer serves real radar tiles only to zoom 7 (confirmed across regions); from zoom 8
        // up every tile is a "Zoom Level Not Supported" placeholder. Cap the source at 7 so MapLibre
        // overzooms the real tiles instead of fetching placeholders.
        maxzoom: 7,
        attribution: 'RainViewer',
      };
      ctx.map.addSource(SOURCE_ID, spec);
    }

    if (!ctx.map.getLayer(LAYER_ID)) {
      const layer: RasterLayerSpecification = {
        id: LAYER_ID,
        type: 'raster',
        source: SOURCE_ID,
        layout: { visibility: effectiveVisible() ? 'visible' : 'none' },
        paint: { 'raster-opacity': opacity },
      };
      ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
      if (lastPaint) applyRasterTheme(ctx.map, LAYER_ID, lastPaint);
    }
  }

  return {
    id: WEATHER_LAYER_IDS.radar,
    title: 'Rain radar',
    description: 'Recent rainfall intensity from weather radar.',
    band: 'weather',
    supportsOpacity: true,
    defaultVisible: false,
    defaultOpacity: DEFAULT_OPACITY,
    layerIds: [LAYER_ID],
    // Nothing is created until a frame lands; sync points the source at the latest frame.
    add() {},
    reset() {
      // The manager calls this on a base-style swap (which recreated nothing), so the next sync
      // re-points the source instead of assuming it is current.
      lastRadar = undefined;
    },
    sync(ctx) {
      const radar = store.radar;
      const frames = radar?.frames ?? [];
      // Re-evaluate the scrub gate every tick: the slider moves without any radar data change.
      applyEffectiveVisibility(ctx);
      if (!effectiveVisible()) return;
      // On new radar data, jump to the latest frame and point the source at it (creating it).
      if (radar !== lastRadar) {
        lastRadar = radar;
        frameIndex = Math.max(0, frames.length - 1);
        if (radar && frames.length > 0) applyFrame(ctx);
        lastAdvance = now();
        return;
      }
      if (!ctx.map.getLayer(LAYER_ID) || !radar || frames.length < 2) return;
      // A reduced-motion preference holds the radar on its latest frame (set on each new-radar branch
      // above) rather than looping, mirroring the wind field and the camera moves.
      if (reducedMotion) return;
      // Advance one frame per FRAME_MS, holding PAUSE_MS on the latest before wrapping to the oldest.
      const interval = frameIndex === frames.length - 1 ? PAUSE_MS : FRAME_MS;
      const t = now();
      if (t - lastAdvance < interval) return;
      lastAdvance = t;
      frameIndex = (frameIndex + 1) % frames.length;
      applyFrame(ctx);
    },
    remove(ctx) {
      desiredVisible = false;
      lastRadar = undefined;
      removeLayersAndSources(ctx.map, [LAYER_ID], [SOURCE_ID]);
    },
    setVisible(ctx, isVisible) {
      const becameVisible = isVisible && !desiredVisible;
      desiredVisible = isVisible;
      applyEffectiveVisibility(ctx);
      if (becameVisible) this.sync(ctx);
    },
    setOpacity(ctx, value) {
      opacity = value;
      if (ctx.map.getLayer(LAYER_ID)) ctx.map.setPaintProperty(LAYER_ID, 'raster-opacity', value);
    },
    applyTheme(ctx, paint) {
      lastPaint = paint;
      if (ctx.map.getLayer(LAYER_ID)) applyRasterTheme(ctx.map, LAYER_ID, paint);
    },
  };
}

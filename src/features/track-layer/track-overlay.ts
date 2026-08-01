import type { ExpressionSpecification, LineLayerSpecification } from 'maplibre-gl';
import {
  douglasPeucker,
  type SavedTracksSource,
  type TrackPoint,
  type TrackRecorder,
} from '$entities/track';
import {
  emptyFeatureCollection,
  ensureGeoJsonSources,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import type { PersistedValue, TrackSettings } from '$shared/settings';
import { trackSegments } from './track-geojson';

const ACTIVE_SOURCE = 'binnacle-track-active';
const ACTIVE_LAYER = 'binnacle-track-active-line';
const SAVED_SOURCE = 'binnacle-track-saved';
const SAVED_LAYER = 'binnacle-track-saved-line';
const BAND = 'track';
// Display simplification tolerance in degrees (about 9 m), so straight legs collapse and a
// long voyage stays light; the raw points stay in storage and in any saved track.
const SIMPLIFY_TOLERANCE = 0.00008;
// The active line is simplified incrementally: only the unsimplified tail since the last frozen point
// is re-run through Douglas-Peucker each fix, so the cost is bounded by the tail length rather than
// the whole multi-hour track. When the tail grows past this many raw points, the older half is frozen
// into the committed prefix (which never changes again) and a kept point near its middle becomes the
// new tail boundary.
const TAIL_WINDOW = 4096;
// SOG color stops in m/s: 0 (slow), 2.5 (about 5 kn), 5 (about 10 kn, fast).
const SOG_MID = 2.5;
const SOG_FAST = 5;

// emptyFeatureCollection() is called per use site rather than aliasing one shared instance into
// setData: MapLibre's setData may retain the reference, so two sources must not share one collection.
const NO_SAVED: SavedTracksSource = { features: () => emptyFeatureCollection(), version: () => 0 };

interface TrackOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

function lineColor(
  paint: MapThemePaint,
  mode: TrackSettings['colorMode'],
): string | ExpressionSpecification {
  if (mode === 'solid') return paint.trackSolid;
  return [
    'interpolate',
    ['linear'],
    ['get', 'sog'],
    0,
    paint.trackSlow,
    SOG_MID,
    paint.trackMid,
    SOG_FAST,
    paint.trackFast,
  ];
}

export function createTrackOverlay(
  recorder: TrackRecorder,
  settings: PersistedValue<TrackSettings>,
  saved: SavedTracksSource = NO_SAVED,
): TrackOverlay {
  let paint = mapThemePaint('day');
  let lastLen = -1;
  let lastT: number | undefined;
  let lastMode: TrackSettings['colorMode'] | undefined;
  let lastSavedVersion = -1;

  // Incremental-simplification state. `committed` is the frozen, already-simplified prefix of the
  // active line; `pendingStart` is the index into recorder.points where the unsimplified tail begins
  // (its first point is the last committed point, the shared boundary). Reset on add().
  let committed: TrackPoint[] = [];
  let pendingStart = 0;

  function resetSimplification(): void {
    committed = [];
    pendingStart = 0;
  }

  // committed.length > 0 always ends at the boundary point shared with the tail's first point, so the
  // render and the next freeze drop that duplicate. One pre-sized output array, not slice().concat(),
  // since this runs on every kept GPS fix once a prefix is frozen.
  function spliceTail(simplifiedTail: TrackPoint[]): TrackPoint[] {
    if (committed.length === 0) return simplifiedTail;
    const prefixLen = committed.length - 1;
    const out = new Array<TrackPoint>(prefixLen + simplifiedTail.length);
    for (let i = 0; i < prefixLen; i += 1) out[i] = committed[i];
    for (let i = 0; i < simplifiedTail.length; i += 1) out[prefixLen + i] = simplifiedTail[i];
    return out;
  }

  // Re-simplify only the tail since the last frozen point, then splice it onto the committed prefix.
  // When the tail outgrows TAIL_WINDOW, freeze its older half so the per-fix cost stays bounded on a
  // long passage. The full raw track is untouched in the recorder and in any saved track.
  function simplifyActive(): TrackPoint[] {
    const points = recorder.points;
    if (pendingStart > points.length) resetSimplification(); // points shrank (a clear); start over
    const tail = points.slice(pendingStart);
    const simplifiedTail = douglasPeucker(tail, SIMPLIFY_TOLERANCE);

    // Nothing interior to freeze: skip, tail stays short.
    if (tail.length <= TAIL_WINDOW || simplifiedTail.length < 3) return spliceTail(simplifiedTail);

    // Freeze the older half. Walk tail and the (in-order) kept points together to recover each kept
    // point's offset in one pass, and pick the last kept point at or before the midpoint as the new
    // boundary, never the first or the final kept point so the boundary always advances and the freeze
    // cannot loop. A long straight leg with no kept point before the midpoint falls through to the
    // second kept point (the first candidate the loop considers).
    const midOffset = Math.floor(tail.length / 2);
    let cut = 1;
    let boundaryOffset = 0;
    let chosen = false;
    let tailIdx = 0;
    for (let k = 1; k < simplifiedTail.length - 1; k += 1) {
      while (tail[tailIdx] !== simplifiedTail[k]) tailIdx += 1;
      if (chosen && tailIdx > midOffset) break;
      cut = k;
      boundaryOffset = tailIdx;
      chosen = true;
    }

    const frozen = simplifiedTail.slice(0, cut + 1);
    committed = spliceTail(frozen);
    pendingStart += boundaryOffset;
    // The boundary stays as the next tail's first point; recompute the now-shorter tail for render.
    return spliceTail(douglasPeucker(points.slice(pendingStart), SIMPLIFY_TOLERANCE));
  }

  function setActiveData(ctx: OverlayContext): void {
    setSourceData(ctx.map, ACTIVE_SOURCE, trackSegments(simplifyActive()));
  }

  return {
    id: 'track',
    title: 'Tracks',
    band: BAND,
    supportsOpacity: true,
    layerIds: [SAVED_LAYER, ACTIVE_LAYER],
    add(ctx) {
      // Reset the dirty-check state so a reattach (after a base-style swap recreates the
      // emptied sources) repopulates them on the next sync instead of staying blank.
      lastLen = -1;
      lastT = undefined;
      lastMode = undefined;
      lastSavedVersion = -1;
      resetSimplification();
      const before = ctx.beforeIdFor(BAND);
      ensureGeoJsonSources(ctx.map, [ACTIVE_SOURCE, SAVED_SOURCE]);
      if (!ctx.map.getLayer(SAVED_LAYER)) {
        const savedLayer: LineLayerSpecification = {
          id: SAVED_LAYER,
          type: 'line',
          source: SAVED_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': paint.trackSolid, 'line-width': 2 },
        };
        ctx.map.addLayer(savedLayer, before);
      }
      if (!ctx.map.getLayer(ACTIVE_LAYER)) {
        const activeLayer: LineLayerSpecification = {
          id: ACTIVE_LAYER,
          type: 'line',
          source: ACTIVE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': lineColor(paint, settings.value.colorMode), 'line-width': 3 },
        };
        ctx.map.addLayer(activeLayer, before);
      }
    },
    sync(ctx) {
      const mode = settings.value.colorMode;
      const points = recorder.points;
      const tail = points[points.length - 1]?.t;
      if (points.length !== lastLen || tail !== lastT) {
        lastLen = points.length;
        lastT = tail;
        setActiveData(ctx);
      }
      // Commit lastMode only once the recolor lands, so a sync that beats add() re-applies on the
      // next tick instead of recording a color the layer never received.
      if (mode !== lastMode && ctx.map.getLayer(ACTIVE_LAYER)) {
        lastMode = mode;
        ctx.map.setPaintProperty(ACTIVE_LAYER, 'line-color', lineColor(paint, mode));
      }
      const savedVersion = saved.version();
      if (savedVersion !== lastSavedVersion) {
        lastSavedVersion = savedVersion;
        setSourceData(ctx.map, SAVED_SOURCE, saved.features());
      }
    },
    // Guarded on getLayer: a theme or opacity change can land before add() attaches the layers, and
    // setPaintProperty throws on a missing one. add() bakes the current theme into the layer
    // specification, and the LayerManager re-applies both once add() resolves.
    applyTheme(ctx, next) {
      paint = next;
      if (ctx.map.getLayer(ACTIVE_LAYER)) {
        ctx.map.setPaintProperty(
          ACTIVE_LAYER,
          'line-color',
          lineColor(paint, settings.value.colorMode),
        );
      }
      if (ctx.map.getLayer(SAVED_LAYER)) {
        ctx.map.setPaintProperty(SAVED_LAYER, 'line-color', paint.trackSolid);
      }
    },
    setVisible(ctx, visible) {
      setLayersVisibility(ctx.map, [ACTIVE_LAYER, SAVED_LAYER], visible);
    },
    setOpacity(ctx, opacity) {
      if (ctx.map.getLayer(ACTIVE_LAYER)) {
        ctx.map.setPaintProperty(ACTIVE_LAYER, 'line-opacity', opacity);
      }
      if (ctx.map.getLayer(SAVED_LAYER)) {
        ctx.map.setPaintProperty(SAVED_LAYER, 'line-opacity', opacity);
      }
    },
    remove(ctx) {
      removeLayersAndSources(ctx.map, [ACTIVE_LAYER, SAVED_LAYER], [ACTIVE_SOURCE, SAVED_SOURCE]);
    },
  };
}

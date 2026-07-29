import type {
  CustomLayerInterface,
  ExpressionSpecification,
  FillLayerSpecification,
  LineLayerSpecification,
  Map as MapLibreMap,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import * as maplibregl from 'maplibre-gl';
import type { LatLon } from '$shared/geo';
import { formatNm, METERS_PER_NAUTICAL_MILE } from '$shared/lib';
import {
  emptyFeatureCollection,
  ensureGeoJsonSource,
  featureCollection,
  type MapThemePaint,
  matrixOf,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import { DEFAULT_RADAR_LEGEND } from './legend';
import { themedColorTable } from './legend-theme';
import type { MarineRadarStore } from './marine-radar-store.svelte';
import { radarAreaFeatures, updateRadarAreaFromChart } from './radar-area-geometry';
import type { RadarFrame } from './radar-frame-core';
import { rangeQuadHalfExtent } from './radar-geo';
import { RadarGl } from './radar-gl';
import { headingLineFeature, rangeRingFeatures } from './radar-vectors';

export const RADAR_ECHO_LAYER_ID = 'marine-radar-echo';
export const RADAR_RINGS_LAYER_ID = 'marine-radar-rings';
export const RADAR_RING_LABELS_LAYER_ID = 'marine-radar-ring-labels';
export const RADAR_AREAS_FILL_LAYER_ID = 'marine-radar-areas-fill';
export const RADAR_AREAS_LINE_LAYER_ID = 'marine-radar-areas-line';
const RINGS_SOURCE_ID = 'marine-radar-rings-src';
export const RADAR_AREAS_SOURCE_ID = 'marine-radar-areas-src';
const RANGE_RINGS = 3;
const RING_COLOR_DAY = '#33ff66';
const RING_COLOR_NIGHT = '#d00000';
// A dark halo behind the ring labels so the bright ring-colored text stays readable over any chart
// feature, in day and dusk; on night-red's true black the halo is invisible and the red text already
// carries its own contrast.
const RING_LABEL_HALO = 'rgba(0, 0, 0, 0.75)';
const AREA_COLOR_DAY = '#ff9f1c';
const AREA_COLOR_NIGHT = '#d00000';
// The range label for a ring's radius: nautical miles, the universal radar range unit.
const ringLabel = (meters: number): string =>
  `${formatNm(meters, meters < METERS_PER_NAUTICAL_MILE ? 2 : 1)} nm`;

// Shared by the radar layer row and the app-menu radar tile so both grayed surfaces explain the
// same thing when no radar is discovered. One source of truth keeps the wording from drifting.
export const RADAR_UNAVAILABLE_HINT =
  'Radar is not available. Open Radar for provider or access details.';

function ringColor(theme: MapThemePaint['theme']): string {
  return theme === 'night-red' ? RING_COLOR_NIGHT : RING_COLOR_DAY;
}

function areaColor(theme: MapThemePaint['theme']): string {
  return theme === 'night-red' ? AREA_COLOR_NIGHT : AREA_COLOR_DAY;
}

function areaFillOpacity(value: number): ExpressionSpecification {
  return [
    'case',
    ['boolean', ['get', 'active'], false],
    0.22 * value,
    ['boolean', ['get', 'enabled'], false],
    0.12 * value,
    0.04 * value,
  ] as ExpressionSpecification;
}

function areaLineOpacity(value: number): ExpressionSpecification {
  return [
    'case',
    ['boolean', ['get', 'enabled'], false],
    0.95 * value,
    0.55 * value,
  ] as ExpressionSpecification;
}

// The sweep wedge color as shader RGB floats: red on night-red (no green at night), classic bright radar
// green otherwise, brighter than the rings so the scanning edge stands out over the echo.
function sweepColor(theme: MapThemePaint['theme']): [number, number, number] {
  return theme === 'night-red' ? [0.75, 0, 0] : [0.4, 1, 0.55];
}

export interface PpiLayer extends OverlayModule {
  sync(ctx: OverlayContext): void;
  pushFrame(frame: RadarFrame): void;
  clearFrame(): void;
  chartEditing(): boolean;
  handleChartPoint(position: LatLon): boolean;
  stopChartEditing(): void;
}

// The marine radar echo as a MapLibre custom WebGL layer (polar texture unwrapped in a shader,
// positioned by the mercator helper, heading as a uniform), plus a range-ring and heading-line GeoJSON
// layer above it. Off by default; in the traffic band so it reads with the live overlays and lands in
// the "Traffic and live data" panel category.
export function createPpiLayer(
  store: MarineRadarStore,
  getCenter: () => LatLon | undefined,
  getHeading: () => number | undefined = () => undefined,
  onVisibilityChange: (visible: boolean) => void = () => undefined,
  freshness: {
    center?: () => boolean;
    heading?: () => boolean;
  } = {},
): PpiLayer {
  let gl: RadarGl | undefined;
  let echoMap: MapLibreMap | undefined;
  let theme: MapThemePaint['theme'] = 'day';
  let opacity = 1;
  let visible = false;
  let frame: RadarFrame | undefined;
  let dirty = false;
  let legendVersion = '';
  // The last ring geometry inputs, compared numerically so sync rewrites the rings source only when the
  // vessel position, range, or heading actually changed (no per-sync string allocation).
  let lastRingLat = Number.NaN;
  let lastRingLon = Number.NaN;
  let lastRingRange = Number.NaN;
  let lastRingHeading = Number.NaN;
  let ringsDrawn = false;
  let lastAreaVersion = -1;
  let lastAreaLat = Number.NaN;
  let lastAreaLon = Number.NaN;
  let lastAreaHeading = Number.NaN;
  let lastAreaRange = Number.NaN;
  // The geodesic ring and label features for the last position and range. Underway the heading
  // updates several times per second while the fix and range hold still, so only the 2-point
  // heading line is rebuilt per sync; the three 65-point rings and their labels are reused.
  let ringFeatures: GeoJSON.Feature[] = [];
  // The last reason the echo render was a no-op, logged only on a transition (render runs every repaint)
  // and only in dev, so "Live but blank" is traceable to no fix, no frame, or zero range.
  let lastSuppress = '';
  // The echo center projected to mercator, cached across frames. render() runs on every repaint while
  // the echo streams, and MercatorCoordinate.fromLngLat allocates, so the projection is recomputed only
  // when the fix actually moves. NaN seeds guarantee the first frame projects.
  let mercLat = Number.NaN;
  let mercLon = Number.NaN;
  let mercX = 0;
  let mercY = 0;

  // The display range to draw at: the integrated frame's range, or the discovered RadarInfo.range when a
  // frame has not yet reported a positive range, so a warmup or a range-omitting spoke does not collapse
  // the echo quad and rings to zero extent.
  function effectiveRange(): number {
    if (frame && frame.range > 0) return frame.range;
    return store.selected?.range ?? 0;
  }

  function effectiveHeading(): number | undefined {
    return frame?.heading ?? (freshness.heading?.() === false ? undefined : getHeading());
  }

  function suppress(reason: string): void {
    if (import.meta.env.DEV && reason !== lastSuppress) {
      console.debug(`[marine-radar] echo not drawn: ${reason}`);
      lastSuppress = reason;
    }
  }

  function applyLegend(): void {
    const legend = store.selected?.legend ?? DEFAULT_RADAR_LEGEND;
    if (gl) gl.setLegend(themedColorTable(legend, theme));
  }

  function addEcho(ctx: OverlayContext): void {
    const canvas = ctx.map.getCanvas();
    let contextLost = false;
    let removed = false;
    let glCtx: WebGL2RenderingContext | undefined;

    function buildGl(): void {
      if (!glCtx) return;
      try {
        gl = new RadarGl(glCtx);
        applyLegend();
        gl.setOpacity(opacity);
        gl.setSweepColor(sweepColor(theme));
        dirty = true;
        store.setRendererStatus('ready');
      } catch (error) {
        // A shader compile or link failure must not abort the whole overlay registration (it runs
        // synchronously inside registerAll): degrade to an empty echo, which the render guard no-ops,
        // and flag the radar status. This mirrors wind-overlay's degrade-on-GL-failure.
        console.warn('[marine-radar] WebGL init failed; radar echo disabled', error);
        gl = undefined;
        store.setRendererStatus(
          'error',
          error instanceof Error ? error.message : 'WebGL initialization failed.',
        );
      }
    }

    const onLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      store.setRendererStatus('context-lost', 'The chart graphics context was lost.');
    };
    const onRestored = () => {
      if (removed) return;
      contextLost = false;
      gl = undefined;
      buildGl();
      if (visible) ctx.map.triggerRepaint();
    };
    const onVisible = () => {
      if (!removed && !document.hidden && visible && gl && !contextLost) ctx.map.triggerRepaint();
    };

    const layer: CustomLayerInterface = {
      id: RADAR_ECHO_LAYER_ID,
      type: 'custom',
      onAdd(map: MapLibreMap, gc: WebGLRenderingContext | WebGL2RenderingContext) {
        echoMap = map;
        glCtx = gc as WebGL2RenderingContext;
        canvas.addEventListener('webglcontextlost', onLost as EventListener);
        canvas.addEventListener('webglcontextrestored', onRestored as EventListener);
        document.addEventListener('visibilitychange', onVisible);
        buildGl();
      },
      render(_gc: WebGLRenderingContext | WebGL2RenderingContext, args: unknown) {
        if (!gl || !visible || contextLost) return suppress('not-ready');
        const centerIsFresh = freshness.center?.() !== false;
        const center = centerIsFresh ? getCenter() : undefined;
        if (frame && !centerIsFresh) {
          store.setRendererStatus(
            'blocked',
            'The own-vessel position is stale, so the radar echo is suppressed.',
          );
        }
        if (!frame || !center) return suppress(frame ? 'no-fix' : 'no-frame');
        const heading = effectiveHeading();
        if (heading === undefined) {
          store.setRendererStatus(
            'blocked',
            'No radar bearing or navigation.headingTrue is available, so the echo is suppressed.',
          );
          return suppress('no-heading');
        }
        if (store.rendererStatus === 'blocked') store.setRendererStatus('ready');
        const matrix = matrixOf(args);
        if (matrix.length !== 16) return suppress('bad-matrix');
        const range = effectiveRange();
        if (range <= 0) return suppress('no-range');
        if (dirty) {
          gl.setData(frame.buffer, frame.spokesPerRev, frame.maxSpokeLen);
          gl.setHeading(heading);
          gl.setSweep(frame.sweep);
          dirty = false;
        }
        if (center.latitude !== mercLat || center.longitude !== mercLon) {
          mercLat = center.latitude;
          mercLon = center.longitude;
          const mc = maplibregl.MercatorCoordinate.fromLngLat({
            lng: center.longitude,
            lat: center.latitude,
          });
          mercX = mc.x;
          mercY = mc.y;
        }
        gl.render(matrix, mercX, mercY, rangeQuadHalfExtent(center.latitude, range));
        lastSuppress = '';
      },
      onRemove() {
        removed = true;
        canvas.removeEventListener('webglcontextlost', onLost as EventListener);
        canvas.removeEventListener('webglcontextrestored', onRestored as EventListener);
        document.removeEventListener('visibilitychange', onVisible);
        gl?.dispose();
        gl = undefined;
        echoMap = undefined;
      },
    };
    ctx.map.addLayer(layer, ctx.beforeIdFor('traffic'));
  }

  function addRings(ctx: OverlayContext): void {
    ensureGeoJsonSource(ctx.map, RINGS_SOURCE_ID);
    if (!ctx.map.getLayer(RADAR_RINGS_LAYER_ID)) {
      // No add-time visibility: the LayerManager always calls setVisible right after add(), which
      // sets it through setLayersVisibility.
      const layer: LineLayerSpecification = {
        id: RADAR_RINGS_LAYER_ID,
        type: 'line',
        source: RINGS_SOURCE_ID,
        paint: { 'line-color': ringColor(theme), 'line-width': 1.5, 'line-opacity': 0.85 },
      };
      ctx.map.addLayer(layer, ctx.beforeIdFor('traffic'));
    }
    // The per-ring range labels sit above the rings and the echo (added last, before the same band id),
    // each annotating its ring with the range, so the rings read as a labeled distance scale.
    if (!ctx.map.getLayer(RADAR_RING_LABELS_LAYER_ID)) {
      const labels: SymbolLayerSpecification = {
        id: RADAR_RING_LABELS_LAYER_ID,
        type: 'symbol',
        source: RINGS_SOURCE_ID,
        filter: ['has', 'label'],
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, -0.7],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': ringColor(theme),
          'text-halo-color': RING_LABEL_HALO,
          'text-halo-width': 1.5,
        },
      };
      ctx.map.addLayer(labels, ctx.beforeIdFor('traffic'));
    }
  }

  function addAreas(ctx: OverlayContext): void {
    ensureGeoJsonSource(ctx.map, RADAR_AREAS_SOURCE_ID);
    if (!ctx.map.getLayer(RADAR_AREAS_FILL_LAYER_ID)) {
      const fill: FillLayerSpecification = {
        id: RADAR_AREAS_FILL_LAYER_ID,
        type: 'fill',
        source: RADAR_AREAS_SOURCE_ID,
        paint: {
          'fill-color': areaColor(theme),
          'fill-opacity': areaFillOpacity(opacity),
        },
      };
      ctx.map.addLayer(fill, ctx.beforeIdFor('traffic'));
    }
    if (!ctx.map.getLayer(RADAR_AREAS_LINE_LAYER_ID)) {
      const line: LineLayerSpecification = {
        id: RADAR_AREAS_LINE_LAYER_ID,
        type: 'line',
        source: RADAR_AREAS_SOURCE_ID,
        paint: {
          'line-color': areaColor(theme),
          'line-width': ['case', ['boolean', ['get', 'active'], false], 3, 2],
          'line-opacity': areaLineOpacity(opacity),
          'line-dasharray': [
            'case',
            ['==', ['get', 'kind'], 'sector'],
            ['literal', [2, 1]],
            ['literal', [1, 0]],
          ],
        },
      };
      ctx.map.addLayer(line, ctx.beforeIdFor('traffic'));
    }
  }

  function syncRings(ctx: OverlayContext): void {
    const center = freshness.center?.() === false ? undefined : getCenter();
    const range = effectiveRange();
    if (!center || !frame || range <= 0) {
      if (ringsDrawn) {
        ringsDrawn = false;
        setSourceData(ctx.map, RINGS_SOURCE_ID, emptyFeatureCollection());
      }
      return;
    }
    const currentHeading = effectiveHeading();
    // Object.is so the no-heading (NaN) case compares equal to itself and does not rebuild every sync.
    const heading = currentHeading ?? Number.NaN;
    const ringsChanged =
      !ringsDrawn ||
      !Object.is(center.latitude, lastRingLat) ||
      !Object.is(center.longitude, lastRingLon) ||
      !Object.is(range, lastRingRange);
    if (!ringsChanged && Object.is(heading, lastRingHeading)) return;
    if (ringsChanged) {
      ringFeatures = rangeRingFeatures(center, range, RANGE_RINGS, ringLabel).features;
    }
    lastRingLat = center.latitude;
    lastRingLon = center.longitude;
    lastRingRange = range;
    lastRingHeading = heading;
    ringsDrawn = true;
    const features =
      currentHeading === undefined
        ? ringFeatures
        : [...ringFeatures, headingLineFeature(center, currentHeading, range)];
    setSourceData(ctx.map, RINGS_SOURCE_ID, featureCollection(features));
  }

  function syncAreas(ctx: OverlayContext): void {
    const center = freshness.center?.() === false ? undefined : getCenter();
    const heading = effectiveHeading();
    const range = effectiveRange();
    const lat = center?.latitude ?? Number.NaN;
    const lon = center?.longitude ?? Number.NaN;
    const headingValue = heading ?? Number.NaN;
    const rangeValue = range > 0 ? range : Number.NaN;
    if (
      store.areaVersion === lastAreaVersion &&
      Object.is(lat, lastAreaLat) &&
      Object.is(lon, lastAreaLon) &&
      Object.is(headingValue, lastAreaHeading) &&
      Object.is(rangeValue, lastAreaRange)
    ) {
      return;
    }
    lastAreaVersion = store.areaVersion;
    lastAreaLat = lat;
    lastAreaLon = lon;
    lastAreaHeading = headingValue;
    lastAreaRange = rangeValue;
    setSourceData(
      ctx.map,
      RADAR_AREAS_SOURCE_ID,
      radarAreaFeatures(store, center, heading, range > 0 ? range : undefined),
    );
  }

  return {
    id: 'marine-radar',
    title: 'Radar',
    description:
      "The radar's own returns painted over the chart: boats, land, and rain it detects.",
    band: 'traffic',
    supportsOpacity: true,
    defaultVisible: false,
    available: () => store.hasRadar,
    unavailableHint: RADAR_UNAVAILABLE_HINT,
    manageable: true,
    layerIds: [
      RADAR_ECHO_LAYER_ID,
      RADAR_RINGS_LAYER_ID,
      RADAR_RING_LABELS_LAYER_ID,
      RADAR_AREAS_FILL_LAYER_ID,
      RADAR_AREAS_LINE_LAYER_ID,
    ],
    add(ctx) {
      addEcho(ctx);
      addRings(ctx);
      addAreas(ctx);
    },
    pushFrame(next) {
      frame = next;
      dirty = true;
      // The echo is data-driven: a new frame requests one repaint, which runs render(); MapLibre's own
      // camera repaints cover pans and zooms, and the rings update (a GeoJSON setSourceData) repaints
      // when the vessel moves. So there is a single repaint path, not a self-scheduling loop plus a tick.
      if (visible) echoMap?.triggerRepaint();
    },
    clearFrame() {
      frame = undefined;
      dirty = true;
      ringsDrawn = false;
      if (echoMap?.getSource(RINGS_SOURCE_ID)) {
        setSourceData(echoMap, RINGS_SOURCE_ID, emptyFeatureCollection());
      }
      echoMap?.triggerRepaint();
    },
    reset() {
      // Drop the cached frame too: on a base-style swap or a radar switch the next render must wait for
      // a fresh spoke frame rather than painting the previous radar's echo at the new geometry.
      frame = undefined;
      dirty = true;
      legendVersion = '';
      ringsDrawn = false;
      lastAreaVersion = -1;
    },
    sync(ctx) {
      const version = store.selectedId ?? '';
      if (version !== legendVersion) {
        legendVersion = version;
        applyLegend();
      }
      syncRings(ctx);
      syncAreas(ctx);
    },
    remove(ctx) {
      removeLayersAndSources(
        ctx.map,
        [
          RADAR_ECHO_LAYER_ID,
          RADAR_RINGS_LAYER_ID,
          RADAR_RING_LABELS_LAYER_ID,
          RADAR_AREAS_FILL_LAYER_ID,
          RADAR_AREAS_LINE_LAYER_ID,
        ],
        [RINGS_SOURCE_ID, RADAR_AREAS_SOURCE_ID],
      );
    },
    setVisible(ctx, value) {
      visible = value;
      onVisibilityChange(value);
      setLayersVisibility(
        ctx.map,
        [
          RADAR_RINGS_LAYER_ID,
          RADAR_RING_LABELS_LAYER_ID,
          RADAR_AREAS_FILL_LAYER_ID,
          RADAR_AREAS_LINE_LAYER_ID,
        ],
        value,
      );
      if (value) ctx.map.triggerRepaint();
    },
    setOpacity(ctx, value) {
      opacity = value;
      gl?.setOpacity(value);
      if (ctx.map.getLayer(RADAR_RINGS_LAYER_ID)) {
        ctx.map.setPaintProperty(RADAR_RINGS_LAYER_ID, 'line-opacity', Math.min(0.85, value));
      }
      if (ctx.map.getLayer(RADAR_RING_LABELS_LAYER_ID)) {
        // Cap with the rings so the whole rings layer fades as one: a label never reads brighter than
        // the ring it annotates.
        ctx.map.setPaintProperty(RADAR_RING_LABELS_LAYER_ID, 'text-opacity', Math.min(0.85, value));
      }
      if (ctx.map.getLayer(RADAR_AREAS_FILL_LAYER_ID)) {
        ctx.map.setPaintProperty(RADAR_AREAS_FILL_LAYER_ID, 'fill-opacity', areaFillOpacity(value));
      }
      if (ctx.map.getLayer(RADAR_AREAS_LINE_LAYER_ID)) {
        ctx.map.setPaintProperty(RADAR_AREAS_LINE_LAYER_ID, 'line-opacity', areaLineOpacity(value));
      }
    },
    applyTheme(ctx, paint) {
      theme = paint.theme;
      applyLegend();
      gl?.setSweepColor(sweepColor(theme));
      if (ctx.map.getLayer(RADAR_RINGS_LAYER_ID)) {
        ctx.map.setPaintProperty(RADAR_RINGS_LAYER_ID, 'line-color', ringColor(paint.theme));
      }
      if (ctx.map.getLayer(RADAR_RING_LABELS_LAYER_ID)) {
        ctx.map.setPaintProperty(RADAR_RING_LABELS_LAYER_ID, 'text-color', ringColor(paint.theme));
      }
      if (ctx.map.getLayer(RADAR_AREAS_FILL_LAYER_ID)) {
        ctx.map.setPaintProperty(RADAR_AREAS_FILL_LAYER_ID, 'fill-color', areaColor(paint.theme));
      }
      if (ctx.map.getLayer(RADAR_AREAS_LINE_LAYER_ID)) {
        ctx.map.setPaintProperty(RADAR_AREAS_LINE_LAYER_ID, 'line-color', areaColor(paint.theme));
      }
    },
    chartEditing() {
      return store.areaDraft?.chartEditing === true;
    },
    handleChartPoint(position) {
      const draft = store.areaDraft;
      const center = freshness.center?.() === false ? undefined : getCenter();
      const heading = effectiveHeading();
      const definition = store.capabilities.find((entry) => entry.id === draft?.controlId);
      if (!draft?.chartEditing) return false;
      if (!center) {
        store.setAreaDraft({
          ...draft,
          chartEditing: false,
          chartStep: 0,
          chartError: 'Chart placement stopped because the own-vessel position is no longer fresh.',
        });
        return false;
      }
      if (!definition) {
        store.setAreaDraft({
          ...draft,
          chartEditing: false,
          chartStep: 0,
          chartError: 'Chart placement stopped because the radar area capability changed.',
        });
        return false;
      }
      if (draft.type !== 'rect' && heading === undefined) {
        store.setAreaDraft({
          ...draft,
          chartEditing: false,
          chartStep: 0,
          chartError:
            'Chart placement stopped because a fresh radar or true heading is unavailable.',
        });
        return false;
      }
      store.setAreaDraft(updateRadarAreaFromChart(draft, definition, center, heading, position));
      return true;
    },
    stopChartEditing() {
      const draft = store.areaDraft;
      if (draft?.chartEditing) {
        store.setAreaDraft({ ...draft, chartEditing: false, chartStep: 0 });
      }
    },
  };
}

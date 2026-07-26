import type {
  CustomLayerInterface,
  ExpressionSpecification,
  LineLayerSpecification,
  Map as MapLibreMap,
} from 'maplibre-gl';
import type { WeatherStore } from '$entities/weather';
import { prefersReducedMotion } from '$shared/lib';
import {
  emptyFeatureCollection,
  ensureGeoJsonSource,
  matrixOf,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setSourceData,
} from '$shared/map';
import type { Theme } from '$shared/ui';
import { WEATHER_LAYER_IDS } from './fills';
import { gridTimeGate } from './grid-time-gate';
import { windArrowFeatures } from './wind-arrows';
import { windColorTexture } from './wind-color-texture';
import { windColorExpression } from './wind-colormap';
import { windFieldTexture } from './wind-field-texture';
import type { GL } from './wind-gl/gl-resources';
import { supportsWindGl } from './wind-gl/wind-gl-support';
import { WindParticles } from './wind-gl/wind-particles';

const SOURCE_ID = 'binnacle-weather-wind';
const LAYER_ID = 'binnacle-weather-wind-line';
const GL_LAYER_ID = 'binnacle-weather-wind-particles';
// Cap the particle simulation at ~25 fps. The custom layer's render runs on every map composite, but
// stepping the field that often pins the Pi GPU at max FPS. Frames closer together than this just
// re-blit the last trail, so the field stays visible while the simulation advances at the capped rate.
const STEP_MS = 40;

export interface WindOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

function sameMatrix(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// The wind layer: an animated WebGL particle field advected through the forecast u/v, colored by
// speed with fading trails, in the weather band. Off by default. Falls back to a per-cell arrow line
// layer when WebGL is unavailable. Rebuilds the wind texture only when the grid or selected time
// changes; the animation runs in the custom layer's own render loop via triggerRepaint, throttled to
// ~25 fps and paused while the document is hidden, and recovers from a WebGL context loss.
export function createWindOverlay(store: WeatherStore): WindOverlay {
  let theme: Theme = 'day';
  let opacity = 1;
  let visible = false;
  const gate = gridTimeGate(store);

  // Particle path.
  let particles: WindParticles | undefined;
  // Reused across composite frames so the per-frame dirty check never allocates; hasLastMatrix keeps
  // the first frame from being read as unchanged before the buffer is filled.
  const lastMatrix: number[] = new Array(16).fill(0);
  let hasLastMatrix = false;
  // The render-loop clock for the simulation throttle, and the cleanup for the context-loss listeners
  // (empty until the particle layer is added, run on its removal).
  let lastStep = 0;
  let removeContextListeners = () => {};

  // Arrow fallback path. windColorExpression stays free of MapLibre types (see wind-colormap.ts),
  // so this is the one place that casts its plain array to the paint property's expression type.
  function colorExpr(t: Theme): ExpressionSpecification {
    return windColorExpression(t) as unknown as ExpressionSpecification;
  }

  function addArrowLayer(ctx: OverlayContext): void {
    ensureGeoJsonSource(ctx.map, SOURCE_ID);
    if (!ctx.map.getLayer(LAYER_ID)) {
      const layer: LineLayerSpecification = {
        id: LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        layout: { 'line-cap': 'round', visibility: visible ? 'visible' : 'none' },
        paint: { 'line-color': colorExpr(theme), 'line-width': 2, 'line-opacity': opacity },
      };
      ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
    }
  }

  function syncArrows(ctx: OverlayContext): void {
    const grid = store.grid;
    setSourceData(
      ctx.map,
      SOURCE_ID,
      grid ? windArrowFeatures(grid, store.bracket) : emptyFeatureCollection(),
    );
  }

  function pushWind(): void {
    if (!particles) return;
    const grid = store.grid;
    const field = grid ? windFieldTexture(grid, store.bracket) : undefined;
    if (field) particles.setWind(field);
  }

  function addParticleLayer(ctx: OverlayContext): void {
    // The GL context can be lost (GPU reset, tab backgrounding, driver hiccup). preventDefault on the
    // lost event lets the browser restore it, and on restore the particle resources are rebuilt so the
    // field recovers instead of staying dead with stale handles.
    let contextLost = false;
    const canvas = ctx.map.getCanvas();
    const onLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
    };
    const onRestored = () => {
      contextLost = false;
      try {
        particles?.reinit();
      } catch (error) {
        // The restored context could not rebuild the particle resources: degrade to arrows.
        console.warn('[wind] particle reinit failed, using arrows', error);
        particles?.dispose();
        particles = undefined;
        addArrowLayer(ctx);
        if (visible) syncArrows(ctx);
      }
    };
    // render() stops requesting frames while the tab is hidden, and nothing else repaints the map on
    // return, so the particle loop would stay frozen until a pan, zoom, or toggle. Resume it here when
    // the tab becomes visible again.
    const onVisible = () => {
      if (!document.hidden && visible && particles && !contextLost) ctx.map.triggerRepaint();
    };

    const layer: CustomLayerInterface = {
      id: GL_LAYER_ID,
      type: 'custom',
      onAdd(_map: MapLibreMap, gl: GL) {
        canvas.addEventListener('webglcontextlost', onLost as EventListener);
        canvas.addEventListener('webglcontextrestored', onRestored as EventListener);
        document.addEventListener('visibilitychange', onVisible);
        removeContextListeners = () => {
          canvas.removeEventListener('webglcontextlost', onLost as EventListener);
          canvas.removeEventListener('webglcontextrestored', onRestored as EventListener);
          document.removeEventListener('visibilitychange', onVisible);
          removeContextListeners = () => {};
        };
        try {
          particles = new WindParticles(gl);
          particles.setTheme(windColorTexture(theme));
          particles.setOpacity(opacity);
          if (visible) pushWind();
        } catch (error) {
          // A rare secondary failure after the probe passed: degrade to arrows. The empty custom
          // layer stays but renders nothing because `particles` is undefined.
          console.warn('[wind] particle init failed, using arrows', error);
          particles = undefined;
          addArrowLayer(ctx);
          if (visible) syncArrows(ctx);
        }
      },
      render(gl: GL, args: unknown) {
        if (!particles || !visible || contextLost) return;
        const matrix = matrixOf(args);
        if (matrix.length < 16) return; // unrecognized render args; MapLibre 5 gives a 4x4 matrix
        const moved = !hasLastMatrix || !sameMatrix(matrix, lastMatrix);
        // Copy, never alias: if MapLibre mutates the matrix in place, sameMatrix would compare an
        // array to itself and never see a move. Overwrite the reused buffer instead of allocating.
        for (let i = 0; i < 16; i += 1) lastMatrix[i] = matrix[i];
        hasLastMatrix = true;
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;
        // A pan or zoom must redraw immediately so the trail clears in place; otherwise step the
        // simulation only at the capped rate and re-blit the last trail on the in-between frames.
        const now = performance.now();
        if (moved || now - lastStep >= STEP_MS) {
          lastStep = now;
          particles.render(matrix, w, h, moved);
        } else {
          particles.blit(w, h);
        }
        // Schedule the next frame only when the document is visible: a hidden tab does not composite,
        // so there is nothing to animate and no reason to keep the GPU awake.
        if (!document.hidden) ctx.map.triggerRepaint();
      },
      onRemove() {
        removeContextListeners();
        particles?.dispose();
        particles = undefined;
      },
    };
    ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
  }

  return {
    id: WEATHER_LAYER_IDS.wind,
    title: 'Wind',
    description: 'Wind speed and direction across the area.',
    band: 'weather',
    supportsOpacity: true,
    defaultVisible: false,
    // Both candidate ids: the particle layer normally, the arrow layer when WebGL is unavailable or
    // a secondary init failure degraded to it. The LayerManager guards each id with getLayer, so the
    // absent one is skipped and a restack never drops the one that is present.
    layerIds: [GL_LAYER_ID, LAYER_ID],
    add(ctx) {
      // The animated particle field is a continuous, self-driving render loop, so a reduced-motion
      // preference falls back to the static arrow layer (which still conveys wind direction and
      // speed), mirroring the camera moves. Evaluated per add, not at construction, so a preference
      // change is honored the next time the overlay is (re)added rather than only after a reload.
      if (supportsWindGl() && !prefersReducedMotion()) addParticleLayer(ctx);
      else addArrowLayer(ctx);
    },
    reset() {
      // The manager calls this on a base-style swap; without it the arrow fallback stays blank when
      // the grid object is unchanged, the same hazard radar-overlay guards against.
      gate.reset();
    },
    sync(ctx) {
      if (!visible) return;
      if (!gate.changed()) return;
      pushWind(); // a no-op without particles
      if (!particles && ctx.map.getLayer(LAYER_ID)) syncArrows(ctx);
    },
    remove(ctx) {
      visible = false;
      removeLayersAndSources(ctx.map, [GL_LAYER_ID, LAYER_ID], [SOURCE_ID]);
    },
    setVisible(ctx, value) {
      const becameVisible = value && !visible;
      visible = value;
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setLayoutProperty(LAYER_ID, 'visibility', value ? 'visible' : 'none');
      }
      if (becameVisible) {
        gate.reset();
        this.sync(ctx);
      }
      // Restart the particle render loop when turned on; render() stops requesting frames when off.
      if (value) ctx.map.triggerRepaint();
    },
    setOpacity(ctx, value) {
      opacity = value;
      particles?.setOpacity(value);
      if (ctx.map.getLayer(LAYER_ID)) ctx.map.setPaintProperty(LAYER_ID, 'line-opacity', value);
    },
    applyTheme(ctx, paint) {
      theme = paint.theme;
      particles?.setTheme(windColorTexture(theme));
      if (ctx.map.getLayer(LAYER_ID)) {
        ctx.map.setPaintProperty(LAYER_ID, 'line-color', colorExpr(theme));
      }
    },
  };
}

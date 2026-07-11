import type {
  CanvasSource,
  CanvasSourceSpecification,
  RasterLayerSpecification,
} from 'maplibre-gl';
import type { TimeBracket, WeatherGrid, WeatherStore } from '$entities/weather';
import { type OverlayContext, type OverlayModule, removeLayersAndSources } from '$shared/map';
import type { Theme } from '$shared/ui';
import type { FieldBitmap } from './field-rgba';
import { gridTimeGate } from './grid-time-gate';

type Quad = [[number, number], [number, number], [number, number], [number, number]];
export type CanvasFactory = () => HTMLCanvasElement;

export interface FieldOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

export interface FieldOverlayOptions {
  id: string;
  title: string;
  // Plain-language gloss for the Layers-panel row tooltip, passed straight to the OverlayModule.
  description?: string;
  sourceId: string;
  layerId: string;
  defaultOpacity?: number;
  fieldRgba: (grid: WeatherGrid, bracket: TimeBracket, theme: Theme) => FieldBitmap | undefined;
}

function defaultCanvas(): HTMLCanvasElement {
  return document.createElement('canvas');
}

// A degenerate default extent; replaced with the grid bbox on the first sync that has data.
const PLACEHOLDER_COORDS: Quad = [
  [0, 0.0001],
  [0.0001, 0.0001],
  [0.0001, 0],
  [0, 0],
];

// A weather scalar field rendered as a MapLibre canvas source drawn at grid resolution and smoothed
// by the GPU (raster-resampling linear), in the weather band. Off by default. The canvas is redrawn
// only when the grid, the selected time, or the theme changes. The source is NOT animated, so it does
// not re-read the canvas or keep the map repainting every frame while visible. After each redraw, one
// play()/pause() forces a single texture re-upload to show the new pixels. Shared by the waves and
// precipitation overlays; waves composes this and adds its own arrow layer on top.
export function createFieldOverlay(
  store: WeatherStore,
  options: FieldOverlayOptions,
  makeCanvas: CanvasFactory = defaultCanvas,
): FieldOverlay {
  const { id, title, description, sourceId, layerId, defaultOpacity, fieldRgba } = options;
  const canvas = makeCanvas();
  let theme: Theme = 'day';
  let visible = false;
  let active = false;
  const gate = gridTimeGate(store);
  let lastTheme: Theme | undefined;
  // Pending frames during which the non-animated source stays "playing" so it re-reads the canvas.
  // A single rAF chain runs at a time; a redraw mid-window just extends the count, never stacks.
  let refreshFrames = 0;
  let refreshRequest: number | undefined;

  function cancelRefresh(): void {
    if (refreshRequest !== undefined) cancelAnimationFrame(refreshRequest);
    refreshRequest = undefined;
    refreshFrames = 0;
  }

  // Force a texture re-upload of the non-animated canvas source after a redraw, then stop. play()
  // sets the source playing and triggers a repaint; the source re-reads the canvas on each render's
  // prepare() while playing. The image source populates its tile asynchronously, so pause() is held
  // for a couple of frames (not called synchronously) to guarantee the new pixels upload before
  // continuous re-reading stops. Repeated calls extend the window rather than starting a second chain.
  function refreshSource(map: OverlayContext['map']): void {
    const source = map.getSource(sourceId) as Partial<CanvasSource> | undefined;
    // A real CanvasSource exposes play/pause; guard so a non-canvas or stubbed source is a no-op.
    if (typeof source?.play !== 'function' || typeof source.pause !== 'function') return;
    source.play();
    refreshFrames = 2;
    if (refreshRequest !== undefined) return;
    const step = () => {
      refreshRequest = undefined;
      if (!active) return;
      refreshFrames -= 1;
      if (refreshFrames > 0) {
        refreshRequest = requestAnimationFrame(step);
        return;
      }
      (map.getSource(sourceId) as Partial<CanvasSource> | undefined)?.pause?.();
    };
    refreshRequest = requestAnimationFrame(step);
  }

  function redraw(): void {
    const grid = store.grid;
    const field = grid ? fieldRgba(grid, store.bracket, theme) : undefined;
    const context = canvas.getContext('2d');
    if (!context) return;
    if (!field) {
      // No field for this grid (for example a partial fetch left waves out): render empty. Leaving
      // the previous pixels would let sync stretch the old field over the new bbox.
      canvas.width = 1;
      canvas.height = 1;
      context.clearRect(0, 0, 1, 1);
      return;
    }
    canvas.width = field.width;
    canvas.height = field.height;
    const image = context.createImageData(field.width, field.height);
    image.data.set(field.data);
    context.putImageData(image, 0, 0);
  }

  function fieldCoords(): Quad | undefined {
    const grid = store.grid;
    if (!grid || grid.lons.length === 0 || grid.lats.length === 0) return undefined;
    const w = grid.lons[0];
    const e = grid.lons[grid.lons.length - 1];
    const s = grid.lats[0];
    const n = grid.lats[grid.lats.length - 1];
    return [
      [w, n],
      [e, n],
      [e, s],
      [w, s],
    ];
  }

  return {
    id,
    title,
    description,
    band: 'weather',
    supportsOpacity: true,
    defaultVisible: false,
    defaultOpacity,
    layerIds: [layerId],
    add(ctx) {
      active = true;
      if (!ctx.map.getSource(sourceId)) {
        const source: CanvasSourceSpecification = {
          type: 'canvas',
          canvas,
          coordinates: PLACEHOLDER_COORDS,
          animate: false,
        };
        ctx.map.addSource(sourceId, source);
      }
      if (!ctx.map.getLayer(layerId)) {
        const layer: RasterLayerSpecification = {
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: { 'raster-opacity': 1, 'raster-resampling': 'linear', 'raster-fade-duration': 0 },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
      }
    },
    reset() {
      // The manager calls this on a base-style swap, which recreated the source emptied, so the next
      // sync must redraw rather than early-return on an unchanged grid reference.
      gate.reset();
      lastTheme = undefined;
    },
    sync(ctx) {
      if (!visible || !active) return;
      // gate.changed() always records the current grid and time; the theme dimension is tracked
      // separately so a theme swap alone (unchanged grid and time) still forces a recolored redraw.
      if (!gate.changed() && theme === lastTheme) return;
      lastTheme = theme;
      redraw();
      const coords = fieldCoords();
      const source = ctx.map.getSource(sourceId) as { setCoordinates(c: Quad): void } | undefined;
      if (coords) source?.setCoordinates(coords);
      // The source is not animated, so MapLibre will not re-read the canvas on its own; force a single
      // texture re-upload to show the freshly drawn pixels, with no permanent repaint.
      refreshSource(ctx.map);
    },
    remove(ctx) {
      active = false;
      visible = false;
      cancelRefresh();
      removeLayersAndSources(ctx.map, [layerId], [sourceId]);
    },
    setVisible(ctx, value) {
      const becameVisible = value && !visible;
      visible = value;
      ctx.map.setLayoutProperty(layerId, 'visibility', value ? 'visible' : 'none');
      if (becameVisible) {
        gate.reset();
        lastTheme = undefined;
        this.sync(ctx);
      }
    },
    setOpacity(ctx, opacity) {
      ctx.map.setPaintProperty(layerId, 'raster-opacity', opacity);
    },
    applyTheme(_ctx, paint) {
      theme = paint.theme;
      lastTheme = undefined; // force a field redraw in the theme's colors on the next sync
    },
  };
}

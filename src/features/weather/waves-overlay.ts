import type { LineLayerSpecification } from 'maplibre-gl';
import type { WeatherStore } from '$entities/weather';
import {
  emptyFeatureCollection,
  ensureGeoJsonSource,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import type { Theme } from '$shared/ui';
import { type CanvasFactory, createFieldOverlay, type FieldOverlay } from './field-overlay';
import { WEATHER_LAYER_IDS } from './fills';
import { gridTimeGate } from './grid-time-gate';
import { becameVisible } from './overlay-visibility';
import { waveArrowFeatures } from './wave-arrows';
import { waveArrowColor } from './wave-colormap';
import { waveFieldRgba } from './wave-field';

const FIELD_SOURCE = 'binnacle-weather-waves-field';
const FIELD_LAYER = 'binnacle-weather-waves-field-layer';
const ARROW_SOURCE = 'binnacle-weather-waves-arrows';
const ARROW_LAYER = 'binnacle-weather-waves-arrow-layer';

type WavesOverlay = FieldOverlay;

// The waves overlay: the shared canvas height field plus a sparse direction-arrow line layer. It
// composes createFieldOverlay for the smooth height field and manages the arrow source and layer
// itself, rebuilding the arrows only when the grid or the selected time changes.
export function createWavesOverlay(store: WeatherStore, makeCanvas?: CanvasFactory): WavesOverlay {
  const field = createFieldOverlay(
    store,
    {
      id: WEATHER_LAYER_IDS.waves,
      title: 'Waves',
      description: 'Significant wave height across the area.',
      sourceId: FIELD_SOURCE,
      layerId: FIELD_LAYER,
      defaultOpacity: 0.7,
      fieldRgba: waveFieldRgba,
    },
    makeCanvas,
  );
  let theme: Theme = 'day';
  let visible = false;
  const gate = gridTimeGate(store);

  // Spread the composed field overlay so its description and default opacity (0.7) carry through,
  // then override only the arrow-aware lifecycle methods and the two-layer id list.
  return {
    ...field,
    layerIds: [FIELD_LAYER, ARROW_LAYER],
    add(ctx) {
      void field.add(ctx);
      ensureGeoJsonSource(ctx.map, ARROW_SOURCE);
      if (!ctx.map.getLayer(ARROW_LAYER)) {
        // The wave field already encodes height by color, so the direction arrows take one flat
        // per-theme color (recolored in applyTheme) rather than the wind overlay's data-driven,
        // speed-shaded line-color: the arrows here carry direction only, not a second height scale.
        const layer: LineLayerSpecification = {
          id: ARROW_LAYER,
          type: 'line',
          source: ARROW_SOURCE,
          layout: { 'line-cap': 'round' },
          paint: { 'line-color': waveArrowColor(theme), 'line-width': 1.5, 'line-opacity': 1 },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
      }
    },
    reset() {
      field.reset?.();
      gate.reset();
    },
    sync(ctx) {
      if (!visible) return;
      field.sync(ctx);
      if (!gate.changed()) return;
      const grid = store.grid;
      setSourceData(
        ctx.map,
        ARROW_SOURCE,
        grid ? waveArrowFeatures(grid, store.bracket) : emptyFeatureCollection(),
      );
    },
    remove(ctx) {
      visible = false;
      removeLayersAndSources(ctx.map, [ARROW_LAYER], [ARROW_SOURCE]);
      field.remove(ctx);
    },
    setVisible(ctx, value) {
      const justBecameVisible = becameVisible(visible, value);
      visible = value;
      field.setVisible(ctx, value);
      setLayersVisibility(ctx.map, [ARROW_LAYER], value);
      if (justBecameVisible) {
        gate.reset();
        this.sync(ctx);
      }
    },
    setOpacity(ctx, opacity) {
      field.setOpacity?.(ctx, opacity);
      ctx.map.setPaintProperty(ARROW_LAYER, 'line-opacity', opacity);
    },
    applyTheme(ctx, paint) {
      theme = paint.theme;
      field.applyTheme?.(ctx, paint);
      ctx.map.setPaintProperty(ARROW_LAYER, 'line-color', waveArrowColor(theme));
    },
  };
}

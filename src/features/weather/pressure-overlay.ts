import type {
  ExpressionSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import type { WeatherStore } from '$entities/weather';
import {
  emptyFeatureCollection,
  type OverlayContext,
  type OverlayModule,
  removeLayersAndSources,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import type { Theme } from '$shared/ui';
import { WEATHER_LAYER_IDS } from './fills';
import { gridTimeGate } from './grid-time-gate';
import { becameVisible } from './overlay-visibility';
import { isobarColors } from './pressure-colors';
import { isobarFeatures } from './pressure-isobars';

const LINE_SOURCE = 'binnacle-weather-pressure';
const LABEL_SOURCE = 'binnacle-weather-pressure-labels';
const LINE_LAYER = 'binnacle-weather-pressure-line';
const LABEL_LAYER = 'binnacle-weather-pressure-label';

interface PressureOverlay extends OverlayModule {
  sync(ctx: OverlayContext): void;
}

// Mean-sea-level pressure isobars in the weather band: a line layer of marching-squares contours
// and a sparse label layer of hPa values. Off by default. Rebuilds only when the grid or the
// selected time changes, like the wind overlay.
export function createPressureOverlay(store: WeatherStore): PressureOverlay {
  let theme: Theme = 'day';
  let visible = false;
  const gate = gridTimeGate(store);

  return {
    id: WEATHER_LAYER_IDS.pressure,
    title: 'Pressure',
    description: 'Barometric pressure contours (isobars) across the area.',
    band: 'weather',
    supportsOpacity: true,
    defaultVisible: false,
    layerIds: [LINE_LAYER, LABEL_LAYER],
    reset() {
      // The manager calls this on a base-style swap, which recreated the emptied sources, so sync()
      // redraws the isobars rather than seeing the unchanged grid and leaving them blank.
      gate.reset();
    },
    add(ctx) {
      const colors = isobarColors(theme);
      for (const id of [LINE_SOURCE, LABEL_SOURCE]) {
        if (!ctx.map.getSource(id)) {
          ctx.map.addSource(id, { type: 'geojson', data: emptyFeatureCollection() });
        }
      }
      if (!ctx.map.getLayer(LINE_LAYER)) {
        const layer: LineLayerSpecification = {
          id: LINE_LAYER,
          type: 'line',
          source: LINE_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': colors.line, 'line-width': 1.2, 'line-opacity': 1 },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
      }
      if (!ctx.map.getLayer(LABEL_LAYER)) {
        const layer: SymbolLayerSpecification = {
          id: LABEL_LAYER,
          type: 'symbol',
          source: LABEL_SOURCE,
          layout: {
            'text-field': ['to-string', ['get', 'pressureHpa']] as ExpressionSpecification,
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'symbol-placement': 'point',
            'text-allow-overlap': false,
          },
          paint: {
            'text-color': colors.label,
            'text-halo-color': colors.halo,
            'text-halo-width': 1.4,
            'text-opacity': 1,
          },
        };
        ctx.map.addLayer(layer, ctx.beforeIdFor('weather'));
      }
    },
    sync(ctx) {
      if (!visible) return;
      if (!gate.changed()) return;
      const grid = store.grid;
      if (!grid) {
        setSourceData(ctx.map, LINE_SOURCE, emptyFeatureCollection());
        setSourceData(ctx.map, LABEL_SOURCE, emptyFeatureCollection());
        return;
      }
      const { lines, labels } = isobarFeatures(grid, store.bracket);
      setSourceData(ctx.map, LINE_SOURCE, lines);
      setSourceData(ctx.map, LABEL_SOURCE, labels);
    },
    remove(ctx) {
      visible = false;
      removeLayersAndSources(ctx.map, [LABEL_LAYER, LINE_LAYER], [LABEL_SOURCE, LINE_SOURCE]);
    },
    setVisible(ctx, value) {
      const justBecameVisible = becameVisible(visible, value);
      visible = value;
      setLayersVisibility(ctx.map, [LINE_LAYER, LABEL_LAYER], value);
      if (justBecameVisible) {
        gate.reset();
        this.sync(ctx);
      }
    },
    setOpacity(ctx, opacity) {
      ctx.map.setPaintProperty(LINE_LAYER, 'line-opacity', opacity);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-opacity', opacity);
    },
    applyTheme(ctx, paint) {
      theme = paint.theme;
      const colors = isobarColors(theme);
      ctx.map.setPaintProperty(LINE_LAYER, 'line-color', colors.line);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-color', colors.label);
      ctx.map.setPaintProperty(LABEL_LAYER, 'text-halo-color', colors.halo);
    },
  };
}

import type { WeatherStore } from '$entities/weather';
import { type CanvasFactory, createFieldOverlay, type FieldOverlay } from './field-overlay';
import { WEATHER_LAYER_IDS } from './fills';
import { precipFieldRgba } from './precip-field';

// The precipitation overlay: the shared canvas field overlay bound to the rain-rate field. Off by
// default, themed, redrawn only on grid, time, or theme change.
export function createPrecipOverlay(store: WeatherStore, makeCanvas?: CanvasFactory): FieldOverlay {
  return createFieldOverlay(
    store,
    {
      id: WEATHER_LAYER_IDS.precip,
      title: 'Precipitation',
      description: 'Precipitation rate across the area.',
      sourceId: 'binnacle-weather-precip-field',
      layerId: 'binnacle-weather-precip-field-layer',
      defaultOpacity: 0.7,
      fieldRgba: precipFieldRgba,
    },
    makeCanvas,
  );
}

import type { WeatherStore } from '$entities/weather';
import { cloudFieldRgba } from './cloud-field';
import { type CanvasFactory, createFieldOverlay, type FieldOverlay } from './field-overlay';
import { WEATHER_LAYER_IDS } from './fills';

// The cloud-cover overlay: the shared canvas field overlay bound to the cloud-cover field. Off by
// default, themed, redrawn only on grid, time, or theme change.
export function createCloudOverlay(store: WeatherStore, makeCanvas?: CanvasFactory): FieldOverlay {
  return createFieldOverlay(
    store,
    {
      id: WEATHER_LAYER_IDS.cloud,
      title: 'Cloud',
      description: 'Cloud cover fraction across the area.',
      sourceId: 'binnacle-weather-cloud-field',
      layerId: 'binnacle-weather-cloud-field-layer',
      defaultOpacity: 0.5,
      fieldRgba: cloudFieldRgba,
    },
    makeCanvas,
  );
}

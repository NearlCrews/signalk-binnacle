import { createRetryableLazyUiLoader } from '$shared/lib';

const weatherMapLoader = createRetryableLazyUiLoader(() => import('./WeatherMap.svelte'));

export function loadWeatherMap(): Promise<typeof import('./WeatherMap.svelte')> {
  return weatherMapLoader();
}

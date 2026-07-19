import { createRetryableLazyLoader } from '$shared/lib';

const weatherMapLoader = createRetryableLazyLoader(() => import('./WeatherMap.svelte'));

export function loadWeatherMap(): Promise<typeof import('./WeatherMap.svelte')> {
  return weatherMapLoader();
}

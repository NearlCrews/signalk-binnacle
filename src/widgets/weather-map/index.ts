let weatherMapModule: Promise<typeof import('./WeatherMap.svelte')> | undefined;

export function loadWeatherMap(): Promise<typeof import('./WeatherMap.svelte')> {
  weatherMapModule ??= import('./WeatherMap.svelte').catch((error: unknown) => {
    weatherMapModule = undefined;
    throw error;
  });
  return weatherMapModule;
}

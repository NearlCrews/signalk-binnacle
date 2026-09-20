import { expect, test } from '@playwright/test';
import { openMenuItem, stubVesselsSelf } from './helpers';

for (const scenario of [
  { theme: 'day', layer: 'wind', motion: 'no-preference' },
  { theme: 'dusk', layer: 'wind', motion: 'reduce' },
  { theme: 'night-red', layer: 'wind', motion: 'no-preference' },
  { theme: 'day', layer: 'pressure', motion: 'reduce' },
] as const) {
  test(`forecast draws ${scenario.layer} pixels in ${scenario.theme} with ${scenario.motion} motion`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: scenario.motion });
    await stubVesselsSelf(page);
    await page.addInitScript(({ layer }) => {
      localStorage.setItem('binnacle:help-orientation', 'true');
      localStorage.setItem(
        'binnacle:weather-layers',
        JSON.stringify({
          'weather-wind': { visible: layer === 'wind', opacity: 1 },
          'weather-pressure': { visible: layer === 'pressure', opacity: 1 },
          'weather-waves': { visible: false, opacity: 1 },
          'weather-radar': { visible: false, opacity: 1 },
        }),
      );
    }, scenario);
    await page.context().route('https://tiles.openfreemap.org/styles/liberty*', (route) =>
      route.fulfill({
        json: {
          version: 8,
          sources: {},
          layers: [
            {
              id: 'base',
              type: 'background',
              paint: { 'background-color': scenario.theme === 'day' ? '#ddd' : '#000' },
            },
          ],
        },
      }),
    );
    await page.route(/\/signalk\/v[12]\/api\/resources\/charts\/?$/, (route) =>
      route.fulfill({ json: {} }),
    );
    await page.context().route(/^https:\/\/api\.open-meteo\.com\/v1\/forecast(?:\?|$)/, (route) => {
      const url = new URL(route.request().url());
      const lats = (url.searchParams.get('latitude') ?? '').split(',').map(Number);
      const lons = (url.searchParams.get('longitude') ?? '').split(',').map(Number);
      const west = Math.min(...lons);
      const span = Math.max(...lons) - west || 1;
      const start = Math.floor(Date.now() / 3_600_000) * 3600;
      return route.fulfill({
        json: lats.map((latitude, i) => ({
          latitude,
          longitude: lons[i],
          hourly: {
            time: [start, start + 3600, start + 7200],
            wind_speed_10m: [5, 5, 5],
            wind_direction_10m: [241, 241, 241],
            wind_gusts_10m: [7, 7, 7],
            pressure_msl: Array(3).fill(1008 + (12 * (lons[i] - west)) / span),
            precipitation: [0, 0, 0],
            cloud_cover: [0, 0, 0],
          },
        })),
      });
    });
    await page.goto('/');
    // Let the fresh-device profile settle before choosing the scenario's theme.
    await expect(
      page.getByRole('button', { name: 'Profile Coastal day, switch profile' }),
    ).toBeVisible();
    const themeToggle = page.getByRole('button', { name: /Switch theme/ });
    for (let step = 0; step < ['day', 'dusk', 'night-red'].indexOf(scenario.theme); step++)
      await themeToggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', scenario.theme);
    await openMenuItem(page, 'Forecast');
    const panel = page.locator('#weather-panel');
    await expect(panel).toBeVisible();
    const canvas = panel.locator('.maplibregl-canvas');
    await expect
      .poll(
        async () => {
          const png = await canvas.screenshot();
          return page.evaluate(
            async ({ bytes, theme, layer }) => {
              const bitmap = await createImageBitmap(
                new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
              );
              const surface = new OffscreenCanvas(bitmap.width, bitmap.height);
              const context = surface.getContext('2d');
              if (!context) throw new Error('No screenshot decoder');
              context.drawImage(bitmap, 0, 0);
              bitmap.close();
              const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
              let colored = 0;
              for (let i = 0; i < pixels.length; i += 4) {
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const overlayPixel =
                  layer === 'pressure'
                    ? b > r + 12 && g > r + 8
                    : theme === 'night-red'
                      ? r > 30 && r > 2 * g && b === 0
                      : g > 1.2 * r && g > b;
                if (overlayPixel) colored++;
              }
              return colored;
            },
            { bytes: [...png], theme: scenario.theme, layer: scenario.layer },
          );
        },
        { timeout: 30_000, message: 'forecast overlay must contribute visible colored pixels' },
      )
      .toBeGreaterThan(100);
    if (scenario.layer === 'pressure')
      await expect(panel.getByText(/may show no lines/)).toBeVisible();
    const screenshotName = `forecast-${scenario.theme}-${scenario.layer}.png`;
    const screenshotPath = testInfo.outputPath(screenshotName);
    await panel.screenshot({ path: screenshotPath });
    await testInfo.attach(screenshotName, {
      path: screenshotPath,
      contentType: 'image/png',
    });
  });
}

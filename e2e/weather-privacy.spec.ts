import { expect, test } from '@playwright/test';
import {
  FIXTURE_ORIGIN,
  FIXTURE_SERVER,
  stubVesselsSelf,
  waitForSignalKConnection,
} from './helpers';

test('sends rounded background warning coordinates with all optional panels closed', async ({
  page,
  context,
}, testInfo) => {
  const weatherRequests: Array<{
    url: string;
    method: string;
    authorizationPresent: boolean;
    elapsedMs: number;
  }> = [];
  const started = Date.now();
  // All positions are synthetic. No request may leave the local fixture, including map tiles,
  // forecast grids, and optional services that could otherwise start independently of a panel.
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === FIXTURE_SERVER) {
      await route.continue();
      return;
    }
    if (
      /(?:^|\.)(?:weather\.gov|open-meteo\.com|rainviewer\.com|met\.no|tidesandcurrents\.noaa\.gov)$/.test(
        url.hostname,
      )
    ) {
      weatherRequests.push({
        url: url.href,
        method: request.method(),
        authorizationPresent: request.headers().authorization !== undefined,
        elapsedMs: Date.now() - started,
      });
    }
    if (url.origin === 'https://api.weather.gov' && url.pathname === '/alerts/active') {
      await route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        json: { type: 'FeatureCollection', features: [] },
      });
    } else await route.abort();
  });
  await stubVesselsSelf(page);
  await page.route('**/signalk/v2/api/weather/_providers', (route) => route.fulfill({ json: {} }));
  await page.addInitScript(() => localStorage.clear());
  const reset = await page.request.post(`${FIXTURE_SERVER}/__fixture__/reset`, { data: {} });
  expect(reset.ok()).toBe(true);
  await page.goto(FIXTURE_ORIGIN);
  await waitForSignalKConnection(page);
  const optionalPanels = page.locator(
    '.slide-over, .weather-panel, #app-menu-launcher, [role="dialog"]',
  );
  await expect(optionalPanels).toHaveCount(0);
  expect(weatherRequests).toEqual([]);

  async function publishSyntheticFix(latitude: number, longitude: number, course: number) {
    const response = await page.request.post(`${FIXTURE_SERVER}/__fixture__/delta`, {
      data: {
        updates: [
          {
            timestamp: new Date().toISOString(),
            values: [
              { path: 'navigation.position', value: { latitude, longitude } },
              { path: 'navigation.speedOverGround', value: 3 },
              { path: 'navigation.courseOverGroundTrue', value: (course * Math.PI) / 180 },
            ],
          },
        ],
      },
    });
    expect(response.ok()).toBe(true);
    // A changing readout proves each real worker frame reached the application before checking
    // suppression. Main-thread clock jumps would make the worker's GPS fix stale instead.
    await expect(page.getByTitle('Course over ground', { exact: true }).locator('b')).toHaveText(
      String(course),
    );
    await expect(optionalPanels).toHaveCount(0);
  }

  await publishSyntheticFix(27.7123456, -82.7123456, 100);
  await expect.poll(() => weatherRequests.length).toBe(1);
  // Movement within the same warning region does not disclose each new GPS sample. The exact
  // ten-minute boundary is covered by the warning watch's injected-clock test.
  for (let update = 1; update <= 3; update += 1) {
    await publishSyntheticFix(27.7123456 + update / 10_000, -82.7123456, 100 + update);
    expect(weatherRequests).toHaveLength(1);
  }
  await publishSyntheticFix(27.8623456, -82.8623456, 104);
  await expect.poll(() => weatherRequests.length).toBe(2);
  expect(
    weatherRequests.map(({ url, method, authorizationPresent }) => ({
      origin: new URL(url).origin,
      path: new URL(url).pathname,
      query: [...new URL(url).searchParams.entries()],
      method,
      authorizationPresent,
    })),
  ).toEqual([
    {
      origin: 'https://api.weather.gov',
      path: '/alerts/active',
      query: [['point', '27.7123,-82.7123']],
      method: 'GET',
      authorizationPresent: false,
    },
    {
      origin: 'https://api.weather.gov',
      path: '/alerts/active',
      query: [['point', '27.8623,-82.8623']],
      method: 'GET',
      authorizationPresent: false,
    },
  ]);
  await testInfo.attach('closed-panels-weather-requests.json', {
    body: JSON.stringify(weatherRequests, null, 2),
    contentType: 'application/json',
  });
});

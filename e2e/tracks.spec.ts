import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('tracks loads saved resources without a live stream and fits a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:map-view', JSON.stringify({ lat: 42.6, lon: -83.5, zoom: 12 }));
  });
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(/\/signalk\/v2\/api\/resources\/tracks$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        saved: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-83.5, 42.6],
              [-83.49, 42.61],
            ],
          },
          properties: { name: 'Morning passage', distance: 1852, timespan: 3600 },
        },
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Tracks' }).click();

  const panel = page.getByRole('complementary', { name: 'Tracks' });
  await expect(panel.getByText('Morning passage')).toBeVisible();
  await expect(panel.getByText('1.00')).toBeVisible();
  await expect(panel.getByText('1h 00m')).toBeVisible();
  await panel.getByRole('button', { name: 'Delete track' }).click();
  await expect(panel.getByText('Delete this track?')).toBeVisible();
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
});

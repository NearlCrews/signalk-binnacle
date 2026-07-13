import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('find places enables its layer, searches provider metadata, and keeps selection visible', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:map-view', JSON.stringify({ lat: 42.6, lon: -83.5, zoom: 12 }));
    localStorage.setItem(
      'binnacle:layers',
      JSON.stringify({ notes: { visible: false, opacity: 1 } }),
    );
  });

  let listRequests = 0;
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(/\/signalk\/v2\/api\/resources\/notes/, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/harbor-1')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'Harbor Marina',
          description: 'Fuel, water, and transient slips.',
          properties: { attribution: 'Community harbor guide' },
        }),
      });
      return;
    }
    const bbox = JSON.parse(url.searchParams.get('bbox') ?? '[-83.51,42.59,-83.49,42.61]') as [
      number,
      number,
      number,
      number,
    ];
    const lon = (bbox[0] + bbox[2]) / 2;
    const lat = (bbox[1] + bbox[3]) / 2;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        'harbor-1': {
          name: 'Harbor Marina',
          position: { latitude: lat, longitude: lon },
          properties: { skIcon: 'marina', source: "Crow's Nest" },
        },
        'fuel-1': {
          name: 'North Fuel Dock',
          position: { latitude: lat + 0.001, longitude: lon + 0.001 },
          properties: { skIcon: 'fuel', source: 'Harbor Guide' },
        },
      }),
    });
    listRequests += 1;
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Find places' }).click();

  const panel = page.getByRole('complementary', { name: 'Find places' });
  await expect(panel).toBeVisible();
  await expect.poll(() => listRequests, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(panel.getByText('Harbor Marina')).toBeVisible();
  await expect(panel.getByText("Marina · Crow's Nest")).toBeVisible();
  await expect(panel.getByText('Distance and bearing need a fresh GPS fix.')).toBeVisible();

  const search = panel.getByRole('searchbox', {
    name: 'Search places by name, category, or source',
  });
  await search.fill('fuel');
  await expect(panel.getByText('North Fuel Dock')).toBeVisible();
  await expect(panel.getByText('Harbor Marina')).not.toBeVisible();
  await search.fill('crow');
  await expect(panel.getByText('Harbor Marina')).toBeVisible();

  const harborRow = panel.getByRole('button', { name: /Harbor Marina/ });
  await harborRow.click();
  await expect(harborRow).toHaveAttribute('aria-current', 'true');
  await expect(
    page.getByRole('complementary', { name: 'Details for Harbor Marina' }),
  ).toBeVisible();

  await expect
    .poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
});

test('find places explains the chart zoom limit on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:map-view', JSON.stringify({ lat: 42.6, lon: -83.5, zoom: 4 }));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Find places' }).click();

  const panel = page.getByRole('complementary', { name: 'Find places' });
  await expect(panel.getByText('Zoom in to level 9 or closer')).toBeVisible();
  await expect
    .poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
});

test('place detail returns to find places on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:map-view', JSON.stringify({ lat: 42.6, lon: -83.5, zoom: 12 }));
  });
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(/\/signalk\/v2\/api\/resources\/notes/, async (route) => {
    if (route.request().url().endsWith('/harbor-1')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ name: 'Harbor Marina', description: 'Protected slips.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        'harbor-1': {
          name: 'Harbor Marina',
          position: { latitude: 42.6, longitude: -83.5 },
          properties: { skIcon: 'marina' },
        },
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Find places' }).click();
  await page.getByRole('button', { name: /Harbor Marina/ }).click();
  const detail = page.getByRole('complementary', { name: 'Details for Harbor Marina' });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Back to find places' }).click();
  await expect(page.getByRole('complementary', { name: 'Find places' })).toBeVisible();
});

import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('waypoints loads without the stream and confirms navigation on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(/\/signalk\/v2\/api\/resources\/waypoints$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        harbor: {
          name: 'Harbor entrance',
          description: 'Keep clear of the breakwater.',
          feature: {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-86.5, 44.1] },
            properties: { skIcon: 'marina' },
          },
        },
      }),
    });
  });

  let destinationWrites = 0;
  await page.route(/\/navigation\/course\/destination$/, async (route) => {
    destinationWrites += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Waypoints' }).click();
  const panel = page.getByRole('complementary', { name: 'Waypoints' });
  await expect(panel.getByText('Harbor entrance')).toBeVisible();
  await panel.getByRole('button', { name: 'Navigate to waypoint' }).click();
  const confirm = panel.getByRole('group', { name: /Start navigation to Harbor entrance/ });
  await expect(confirm).toBeVisible();
  expect(destinationWrites).toBe(0);
  await confirm.getByRole('button', { name: 'Start navigation' }).click();
  await expect.poll(() => destinationWrites).toBe(1);
  await expect
    .poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
});

test('measure draws incremental legs, keeps active work on menu retap, and restores the cursor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Measure' }).click();

  const strip = page.getByRole('complementary', { name: 'Measure' });
  const canvas = page.locator('.maplibregl-canvas');
  await expect(strip.getByText('Tap the chart to set the start point')).toBeVisible();
  await expect(canvas).toHaveCSS('cursor', 'crosshair');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('map canvas did not lay out');
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await expect(strip.getByText('Tap the chart to set the next point')).toBeVisible();
  await page.mouse.click(box.x + box.width * 0.65, box.y + box.height * 0.5);
  await expect(strip.getByText('2 points. Tap the chart to add another')).toBeVisible();
  await expect(strip.getByText('Bearing')).toBeVisible();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Measure' }).click();
  await expect(strip.getByText('2 points. Tap the chart to add another')).toBeVisible();
  await strip.getByRole('button', { name: 'Undo' }).click();
  await expect(strip.getByText('Tap the chart to set the next point')).toBeVisible();
  await expect
    .poll(() => strip.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
  await strip.getByRole('button', { name: 'Done' }).click();
  await expect(strip).not.toBeVisible();
  await expect(canvas).not.toHaveCSS('cursor', 'crosshair');
});

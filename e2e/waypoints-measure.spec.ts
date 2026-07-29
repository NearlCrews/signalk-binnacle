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

test('measure edits middle points with pointer and keyboard paths, then restores the cursor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Measure' }).click();

  const strip = page.getByRole('complementary', { name: 'Measure' });
  const canvas = page.locator('.maplibregl-canvas');
  await expect(strip.getByText('Tap the chart to set the start point')).toBeVisible();
  await expect(canvas).toHaveCSS('cursor', 'crosshair');
  async function clickChart(
    xFraction: number,
    yFraction: number,
  ): Promise<{ dx: number; dy: number }> {
    const box = await canvas.boundingBox();
    if (!box) throw new Error('map canvas did not lay out');
    const stripBox = await strip.boundingBox();
    const x = box.x + box.width * xFraction;
    const openChartBottom = Math.min(
      box.y + box.height,
      stripBox ? stripBox.y - 12 : box.y + box.height,
    );
    const y = box.y + (openChartBottom - box.y) * yFraction;
    await page.mouse.click(x, y);
    return {
      dx: x - (box.x + box.width / 2),
      dy: y - (box.y + box.height / 2),
    };
  }

  await clickChart(0.3, 0.35);
  await expect(strip.getByText('Tap the chart to set the next point')).toBeVisible();
  const middleOffset = await clickChart(0.55, 0.45);
  await expect(strip.getByText('2 points. Tap the chart to add another')).toBeVisible();
  await expect(strip.getByText('Bearing')).toBeVisible();
  await clickChart(0.72, 0.6);
  await expect(strip.getByText('3 points. Tap the chart to add another')).toBeVisible();

  // Project the middle point from the canvas center. A responsive strip resize preserves the map
  // center and zoom, so this remains accurate while the generous 44 px hit target absorbs rounding.
  const editBox = await canvas.boundingBox();
  if (!editBox) throw new Error('map canvas did not lay out for editing');
  const middleX = editBox.x + editBox.width / 2 + middleOffset.dx;
  const middleY = editBox.y + editBox.height / 2 + middleOffset.dy;
  await page.mouse.click(middleX, middleY);
  await expect(strip.getByText('Point 2 selected', { exact: false })).toBeVisible();
  await expect(strip.getByLabel('Previous measurement point')).toBeEnabled();
  await expect(strip.getByLabel('Next measurement point')).toBeEnabled();

  const total = strip.locator('.selected-readout .metric').filter({ hasText: 'Total' });
  const totalBeforeDrag = await total.textContent();
  await strip.getByRole('button', { name: 'Move point' }).click();
  await page.mouse.move(middleX, middleY);
  await page.mouse.down();
  await page.mouse.move(middleX + 45, middleY - 30, { steps: 5 });
  await page.mouse.up();
  await expect(strip.getByText('Point 2 selected', { exact: false })).toBeVisible();
  await expect.poll(() => total.textContent()).not.toBe(totalBeforeDrag);

  await strip.getByRole('button', { name: 'Delete measurement point 2' }).click();
  await expect(
    strip.locator('.selected-readout .metric').filter({ hasText: 'Point 2 of 2' }),
  ).toBeVisible();
  await strip.getByRole('button', { name: 'Undo' }).click();
  await expect(
    strip.locator('.selected-readout .metric').filter({ hasText: 'Point 2 of 3' }),
  ).toBeVisible();

  // MapLibre's canvas keyboard controls provide the non-pointer movement path. Pan, then commit the
  // selected point to the chart center from a regular focusable strip button.
  await strip.getByRole('button', { name: 'Move point' }).click();
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  await strip.getByRole('button', { name: 'Move to chart center' }).click();
  await expect(strip.getByText('Point 2 selected', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  await expect(strip.getByText('Point 2 selected', { exact: false })).toBeVisible();
  await strip.getByRole('button', { name: 'Move point' }).click();
  await page.keyboard.press('Escape');
  await expect(strip.getByText('Point 2 selected', { exact: false })).toBeVisible();
  await expect
    .poll(() => strip.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(strip).not.toBeVisible();
  await expect(canvas).not.toHaveCSS('cursor', 'crosshair');
});

test('measure and route editing refuse overlapping chart gestures in both directions', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.clear());
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Measure' }).click();
  const strip = page.getByRole('complementary', { name: 'Measure' });
  await expect(strip).toBeVisible();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Routes' }).click();
  const routes = page.getByRole('complementary', { name: 'Routes' });
  await routes.getByRole('button', { name: 'New route' }).click();
  await expect(page.getByText('Finish the measurement before editing a route.')).toBeVisible();
  await expect(strip).toBeVisible();

  await strip.getByRole('button', { name: 'Done' }).click();
  await routes.getByRole('button', { name: 'New route' }).click();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const blockedMeasure = page.getByRole('button', { name: 'Measure', exact: true });
  await expect(blockedMeasure).toBeDisabled();
  await expect(blockedMeasure).toHaveAttribute(
    'title',
    'Measure (save or cancel the route edit first)',
  );
});

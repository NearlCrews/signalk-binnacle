import { expect, test } from '@playwright/test';
import {
  expectHelmHitTarget,
  expectNoHorizontalOverflow,
  openMenuItem,
  stubVesselsSelf,
} from './helpers';

test.use({ serviceWorkers: 'block' });

test('route drawing survives Escape keyup until discard is confirmed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
  await page.route(/\/signalk\/v2\/api\/resources\/routes$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/');
  await expect(page.locator('.maplibregl-ctrl-scale')).toContainText(/nm|km/);
  await openMenuItem(page, 'Routes');
  const routes = page.getByRole('complementary', { name: 'Routes', exact: true });
  await routes.getByRole('button', { name: 'New route', exact: true }).click();
  const editing = page.getByRole('complementary', { name: 'Route editing', exact: true });
  const count = editing.getByRole('status');
  const canvas = page.locator('.maplibregl-canvas');
  // Terra Draw sets this cursor when the drawing mode and its listeners are ready.
  await expect(canvas).toHaveCSS('cursor', 'crosshair');
  const plotPoint = async (xFraction: number, yFraction: number): Promise<void> => {
    const chartBox = await canvas.boundingBox();
    const editBox = await editing.boundingBox();
    if (!chartBox || !editBox) throw new Error('Route drawing surfaces did not lay out');
    const openBottom = Math.min(chartBox.y + chartBox.height, editBox.y - 12);
    await page.mouse.click(
      chartBox.x + chartBox.width * xFraction,
      chartBox.y + (openBottom - chartBox.y) * yFraction,
    );
  };
  await plotPoint(0.3, 0.3);
  await expect(count).toContainText('1 point.');
  await plotPoint(0.65, 0.5);
  await expect(count).toContainText('2 points.');
  await canvas.focus();
  await page.keyboard.down('Escape');
  const discard = routes.getByRole('group', { name: 'Discard unsaved route changes?' });
  await expect(discard).toBeVisible();
  await expect(count).toContainText('2 points.');
  await page.keyboard.up('Escape');
  await expect(discard).toBeVisible();
  await expect(count).toContainText('2 points.');
  // Cancel keeps editing; the draft and Terra Draw's in-progress line must both survive.
  await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(discard).toBeHidden();
  await expect(routes.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await routes.getByRole('button', { name: 'Minimize panel' }).click();
  await plotPoint(0.8, 0.6);
  await expect(count).toContainText('3 points.');
});

test('creates measurement and route geometry without chart gestures and exposes route discard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
  await page.route(/\/signalk\/v2\/api\/resources\/routes$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    }),
  );
  await page.goto('/');
  await expect(page.locator('.maplibregl-ctrl-scale')).toContainText(/nm|km/);
  await openMenuItem(page, 'Measure');
  const measure = page.getByRole('complementary', { name: 'Measure', exact: true });
  await measure.getByRole('button', { name: 'Enter measurement coordinates' }).click();
  await measure.getByLabel(/Latitude in degrees/).fill('44');
  await measure.getByLabel(/Latitude in degrees/).blur();
  await measure.getByLabel(/Longitude in degrees/).fill('-86');
  await measure.getByLabel(/Longitude in degrees/).blur();
  const addMeasurement = measure.getByRole('button', {
    name: 'Add measurement point',
    exact: true,
  });
  await addMeasurement.focus();
  await page.keyboard.press('Enter');
  await measure.getByLabel(/Latitude in degrees/).fill('44.01');
  await measure.getByLabel(/Latitude in degrees/).blur();
  await addMeasurement.focus();
  await page.keyboard.press('Enter');
  await expect(measure.getByText('2 points. Tap the chart to add another')).toBeVisible();
  await measure.getByRole('button', { name: 'Done', exact: true }).click();

  await openMenuItem(page, 'Routes');
  const routes = page.getByRole('complementary', { name: 'Routes', exact: true });
  await routes.getByRole('button', { name: 'New route', exact: true }).click();
  await routes.getByRole('button', { name: 'Expand panel' }).click();
  await routes.getByRole('button', { name: 'Edit route points without dragging' }).click();
  await routes.getByLabel(/Latitude in degrees/).fill('44');
  await routes.getByLabel(/Latitude in degrees/).blur();
  await routes.getByLabel(/Longitude in degrees/).fill('-86');
  await routes.getByLabel(/Longitude in degrees/).blur();
  const addRoutePoint = routes.getByRole('button', { name: 'Add point', exact: true });
  await addRoutePoint.focus();
  await page.keyboard.press('Enter');
  await routes.getByLabel(/Latitude in degrees/).fill('44.02');
  await routes.getByLabel(/Latitude in degrees/).blur();
  await addRoutePoint.focus();
  await page.keyboard.press('Enter');
  await expect(routes.getByRole('option', { name: /^Point 2/ })).toBeAttached();
  const moveEarlier = routes.getByRole('button', { name: 'Move point earlier', exact: true });
  const routePoint = routes.getByRole('combobox', { name: 'Route point', exact: true });
  await moveEarlier.focus();
  await page.keyboard.press('Enter');
  await expect(routePoint).toHaveValue('0');
  await expect(routePoint).toBeFocused();
  await expect(routes.getByLabel(/Latitude in degrees/)).toHaveValue('44.02');
  await expect(moveEarlier).toBeDisabled();
  await routes.getByRole('button', { name: 'Undo point edit', exact: true }).click();
  await routePoint.selectOption('0');
  await expect(routes.getByLabel(/Latitude in degrees/)).toHaveValue('44');
  await routes.getByRole('button', { name: 'Minimize panel' }).click();
  const close = routes.getByRole('button', { name: 'Close routes panel' });
  await expectHelmHitTarget(close);
  await close.click();
  await expect(routes.getByRole('group', { name: /Discard/ })).toBeVisible();
});

test('waypoints loads without the stream and confirms navigation on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
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
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Waypoints' }).click();
  const panel = page.getByRole('complementary', { name: 'Waypoints' });
  await expect(panel.getByText('Harbor entrance')).toBeVisible();
  await panel.getByRole('button', { name: 'Navigate to waypoint' }).click();
  const confirm = panel.getByRole('group', { name: /Start navigation to Harbor entrance/ });
  await expect(confirm).toBeVisible();
  expect(destinationWrites).toBe(0);
  await confirm.getByRole('button', { name: 'Start navigation' }).click();
  await expect.poll(() => destinationWrites).toBe(1);
  await expectNoHorizontalOverflow(panel);
});

test('measure edits middle points with pointer and keyboard paths, then restores the cursor', async ({
  page,
}) => {
  // A taller phone than the layout tests use, on purpose: the measure strip is a tool surface that
  // grows with each point up to its documented 60dvh cap (.bottom-stack), and this test re-clicks
  // the middle point at a remembered screen position after that growth. At 568 the capped strip
  // leaves barely thirty pixels of chart above it, so the remembered point ends up underneath the
  // tool. Narrow-width layout behavior is covered by the panel test above.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Measure', exact: true }).click();

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

  // A chart tool arms its crosshair as soon as MapLibre creates the canvas, but the tap handler is
  // only registered once the base style finishes loading, so the opening tap can land in between
  // and be dropped. Retrying is safe rather than double-adding: a tap with no handler attached is
  // discarded outright, never queued for delivery once one appears.
  await expect(async () => {
    await clickChart(0.3, 0.35);
    await expect(strip.getByText('Tap the chart to set the next point')).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
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
  // Fail loudly if the grown strip has covered the point: a silent miss here reads as a broken
  // selection rather than a layout change, which cost real time once.
  const grownStrip = await strip.boundingBox();
  if (grownStrip && middleY > grownStrip.y - 8) {
    throw new Error(
      `the measure strip grew over the middle point: point y ${Math.round(middleY)} against strip top ${Math.round(grownStrip.y)}`,
    );
  }
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
  // MapLibre eases a keyboard pan over its own animation, and the button below commits the CURRENT
  // center, so the assertion depends on the pan having landed. Its end fires on the map, not the
  // page, so a settle window is what is available here.
  await page.waitForTimeout(150);
  await strip.getByRole('button', { name: 'Move to chart center' }).click();
  await expect(strip.getByText('Point 2 selected', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  await expect(strip.getByText('Point 2 selected', { exact: false })).toBeVisible();
  await strip.getByRole('button', { name: 'Move point' }).click();
  await page.keyboard.press('Escape');
  await expect(strip.getByText('Point 2 selected', { exact: false })).toBeVisible();
  await expectNoHorizontalOverflow(strip);
  await page.keyboard.press('Escape');
  await expect(strip).not.toBeVisible();
  await expect(canvas).not.toHaveCSS('cursor', 'crosshair');
});

test('measure and route editing refuse overlapping chart gestures in both directions', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
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

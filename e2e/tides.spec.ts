import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { expectNoHorizontalOverflow, openMenuItem, stubVesselsSelf } from './helpers';
import { installMapLibreWorkerProof } from './maplibre-worker-proof';

test.use({ serviceWorkers: 'block' });

const tideStations = [
  { id: 'T1', name: 'Harbor tide', lat: 27.7, lng: -82.7 },
  { id: 'T2', name: 'Pass tide', lat: 27.72, lng: -82.72 },
];
// NOAA's live currentpredictions catalog repeats some stable ids. Keep that production shape in
// every panel-opening test so a duplicate keyed row cannot regress unnoticed.
const currentStations = [
  { id: 'C1', name: 'Channel current', lat: 27.77, lng: -82.77 },
  { id: 'C1', name: 'Channel current', lat: 27.77, lng: -82.77 },
  { id: 'C1', name: 'Channel current', lat: 27.77, lng: -82.77 },
];

async function mockCoops(page: Page): Promise<void> {
  await page.route(
    /^https:\/\/api\.tidesandcurrents\.noaa\.gov\/mdapi\/prod\/webapi\/stations\.json(?:\?.*)?$/,
    async (route) => {
      const type = new URL(route.request().url()).searchParams.get('type');
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify({
          stations: type === 'currentpredictions' ? currentStations : tideStations,
        }),
      });
    },
  );
  await page.route(
    /^https:\/\/api\.tidesandcurrents\.noaa\.gov\/api\/prod\/datagetter(?:\?.*)?$/,
    async (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get('product') === 'currents_predictions') {
        await route.fulfill({
          status: 200,
          headers: { 'access-control-allow-origin': '*' },
          contentType: 'application/json',
          body: JSON.stringify({
            current_predictions: {
              cp: [
                {
                  Time: '2026-07-29 10:00',
                  Velocity_Major: 82,
                  Type: 'flood',
                  meanFloodDir: 110,
                },
                {
                  Time: '2026-07-29 16:00',
                  Velocity_Major: -61,
                  Type: 'ebb',
                  meanEbbDir: 290,
                },
              ],
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
        contentType: 'application/json',
        body: JSON.stringify({
          predictions: [
            { t: '2026-07-29 09:00', v: '0.72', type: 'H' },
            { t: '2026-07-29 15:00', v: '0.11', type: 'L' },
          ],
        }),
      });
    },
  );
}

async function waitForCenterStationHit(page: Page): Promise<{ x: number; y: number }> {
  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('map canvas did not lay out');
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await expect
    .poll(
      async () => {
        // NOAA can answer before the overlay sync and MapLibre worker have painted the station.
        // Cross the target on every probe. Its delegated mouseenter proves that the matching hit
        // geometry, not just the source data, is queryable in the rendered frame.
        await page.mouse.move(center.x + 60, center.y);
        await page.mouse.move(center.x, center.y);
        return canvas.evaluate((element) => element.style.cursor);
      },
      { message: 'center Tide station did not become hittable' },
    )
    .toBe('pointer');
  return center;
}

async function touchTap(page: Page, point: { x: number; y: number }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...point, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('warms Tide controls before a visible station marker is selected', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:help-orientation', 'true');
    localStorage.setItem('binnacle:map-view', JSON.stringify({ lat: 27.7, lon: -82.7, zoom: 10 }));
    localStorage.setItem(
      'binnacle:layers',
      JSON.stringify({ tides: { visible: true, opacity: 1 } }),
    );
  });
  await stubVesselsSelf(page);
  await mockCoops(page);

  const panelChunk = page.waitForResponse(/\/assets\/TidesPanel-[^/]+\.js$/);
  await page.goto('/');
  await expect(page.getByRole('complementary', { name: 'Tides and currents' })).toHaveCount(0);
  expect((await panelChunk).status()).toBe(200);
});

test('opens Tides from a station enabled only through Layers and charts', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:help-orientation', 'true');
    localStorage.setItem('binnacle:map-view', JSON.stringify({ lat: 27.7, lon: -82.7, zoom: 10 }));
  });
  await stubVesselsSelf(page);
  const workerProof = await installMapLibreWorkerProof(page);
  await mockCoops(page);
  await page.goto('/');
  await workerProof.assertInitialNavigation();

  await openMenuItem(page, 'Layers and charts');
  const layers = page.locator('#layers-panel');
  await layers
    .getByLabel('Layers and charts view')
    .getByRole('button', { name: 'Overlays' })
    .click();
  await layers.getByRole('button', { name: /Chart overlays and marks/ }).click();
  const tideLayer = layers
    .locator('[data-layer-row="tides"]')
    .getByRole('checkbox', { name: 'Tide stations' });
  const prediction = page.waitForResponse(
    (response) =>
      response.url().includes('/api/prod/datagetter') &&
      new URL(response.url()).searchParams.get('product') === 'predictions',
  );
  await tideLayer.check();
  await prediction;
  await layers.getByRole('button', { name: 'Close layers and charts' }).click();

  const center = await waitForCenterStationHit(page);
  await page.mouse.click(center.x, center.y);

  const panel = page.getByRole('complementary', { name: 'Tides and currents' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: /Harbor tide/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(panel.getByRole('button', { name: /Channel current/ })).toHaveCount(1);
});

test('opens Tides from a direct chart touch tap', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:help-orientation', 'true');
    localStorage.setItem('binnacle:map-view', JSON.stringify({ lat: 27.7, lon: -82.7, zoom: 10 }));
    localStorage.setItem(
      'binnacle:layers',
      JSON.stringify({ tides: { visible: true, opacity: 1 } }),
    );
  });
  await stubVesselsSelf(page);
  const workerProof = await installMapLibreWorkerProof(page);
  await mockCoops(page);
  const prediction = page.waitForResponse(
    (response) =>
      response.url().includes('/api/prod/datagetter') &&
      new URL(response.url()).searchParams.get('product') === 'predictions',
  );
  await page.goto('/');
  await workerProof.assertInitialNavigation();
  await prediction;

  const center = await waitForCenterStationHit(page);
  await touchTap(page, center);

  const panel = page.getByRole('complementary', { name: 'Tides and currents' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: /Harbor tide/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
});

test('selects stations by keyboard and marker tap on a narrow chart', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:help-orientation', 'true');
    localStorage.setItem('binnacle:map-view', JSON.stringify({ lat: 27.7, lon: -82.7, zoom: 10 }));
  });
  const workerProof = await installMapLibreWorkerProof(page);
  await mockCoops(page);
  await stubVesselsSelf(page);
  await page.goto('/');
  await workerProof.assertInitialNavigation();

  await openMenuItem(page, 'Tides and currents');
  const panel = page.getByRole('complementary', { name: 'Tides and currents' });
  await expect(panel.getByRole('button', { name: /Pass tide/ })).toBeVisible();
  await expect(panel).toHaveCount(1);

  const passTide = panel.getByRole('button', { name: /Pass tide/ });
  await passTide.focus();
  await page.keyboard.press('Enter');
  await expect(passTide).toHaveAttribute('aria-current', 'true');
  await expect(panel.getByText('Pass tide', { exact: true }).last()).toBeVisible();

  await panel.getByRole('button', { name: 'Show stations on chart' }).click();
  await panel.getByRole('button', { name: 'Minimize panel' }).click();
  await expect(panel.locator('.panel-body')).toHaveClass(/panel-body--collapsed/);

  const canvas = page.locator('.maplibregl-canvas');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('map canvas did not lay out');
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);

  await expect(panel.locator('.panel-body')).not.toHaveClass(/panel-body--collapsed/);
  await expect(panel.getByRole('button', { name: /Harbor tide/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(panel.getByRole('button', { name: 'Back to menu' })).toBeVisible();

  await panel.getByRole('button', { name: 'Close tides panel' }).click();
  const chartOpenedPanel = page.getByRole('complementary', { name: 'Tides and currents' });

  // Keep the chart center clear of the phone-height Measure strip while proving that its delegated
  // marker gate consumes the exact Tide station tap.
  await page.setViewportSize({ width: 800, height: 700 });
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  const measure = page.getByRole('complementary', { name: 'Measure' });
  await expect(measure).toBeVisible();
  await expect(page.locator('#app-menu-launcher')).not.toBeVisible();
  const measureCanvasBox = await canvas.boundingBox();
  if (!measureCanvasBox) throw new Error('measure map canvas did not lay out');
  await touchTap(page, {
    x: measureCanvasBox.x + measureCanvasBox.width / 2,
    y: measureCanvasBox.y + measureCanvasBox.height / 2,
  });
  await expect(measure.getByText('Tap the chart to set the next point')).toBeVisible();
  await expect(chartOpenedPanel).toHaveCount(0);
  await measure.getByRole('button', { name: 'Done' }).click();

  const expandedCanvasBox = await canvas.boundingBox();
  if (!expandedCanvasBox) throw new Error('expanded map canvas did not lay out');
  await canvas.click({
    position: { x: expandedCanvasBox.width / 2, y: expandedCanvasBox.height / 2 },
  });
  await expect(chartOpenedPanel).toBeVisible();
  await expect(chartOpenedPanel.getByRole('button', { name: 'Back to menu' })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 568 });

  await expectNoHorizontalOverflow(page.locator('body'));
  const accessibility = await new AxeBuilder({ page })
    .include('aside[aria-label="Tides and currents"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test('can leave Tides while its controls are still loading', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:help-orientation', 'true');
  });
  await stubVesselsSelf(page);
  let releaseChunk = () => {};
  const chunkGate = new Promise<void>((resolve) => {
    releaseChunk = resolve;
  });
  await page.route(/\/assets\/TidesPanel-[^/]+\.js$/, async (route) => {
    await chunkGate;
    await route.continue();
  });

  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    const menuTides = page
      .locator('#app-menu-launcher')
      .getByRole('button', { name: 'Tides and currents', exact: true });
    await menuTides.click();
    const pending = page.getByRole('complementary', { name: 'Tides and currents' });
    await expect(pending.getByText('Loading Tides controls…', { exact: true })).toBeVisible();
    await pending.getByRole('button', { name: 'Back to menu' }).click();
    await expect(pending).not.toBeVisible();

    await expect(menuTides).toBeVisible();
    await menuTides.click();
    await expect(pending.getByText('Loading Tides controls…', { exact: true })).toBeVisible();
    await pending.getByRole('button', { name: 'Close tides panel' }).click();
    await expect(pending).not.toBeVisible();

    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await menuTides.click();
    await expect(pending.getByText('Loading Tides controls…', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pending).not.toBeVisible();
  } finally {
    releaseChunk();
  }
});

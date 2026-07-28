import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { installMapLibreWorkerProof } from './maplibre-worker-proof';

test.use({ serviceWorkers: 'block' });

const tideStations = [
  { id: 'T1', name: 'Harbor tide', lat: 27.7, lng: -82.7 },
  { id: 'T2', name: 'Pass tide', lat: 27.72, lng: -82.72 },
];
const currentStations = [{ id: 'C1', name: 'Channel current', lat: 27.77, lng: -82.77 }];

async function mockCoops(page: Page): Promise<void> {
  await page.route(
    /api\.tidesandcurrents\.noaa\.gov\/mdapi\/prod\/webapi\/stations\.json/,
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
  await page.route(/api\.tidesandcurrents\.noaa\.gov\/api\/prod\/datagetter/, async (route) => {
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
  });
}

test('selects stations by keyboard and marker tap on a narrow chart', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:map-view', JSON.stringify({ lat: 27.7, lon: -82.7, zoom: 10 }));
  });
  const workerProof = await installMapLibreWorkerProof(page);
  await mockCoops(page);
  await page.route(/\/signalk\/v1\/api\/vessels\/self$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await workerProof.assertInitialNavigation();

  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .locator('#app-menu-launcher')
    .getByRole('button', { name: 'Tides', exact: true })
    .click();
  const panel = page.getByRole('complementary', { name: 'Tides' });
  await expect(panel.getByRole('button', { name: /Pass tide/ })).toBeVisible();

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
  const expandedCanvasBox = await canvas.boundingBox();
  if (!expandedCanvasBox) throw new Error('expanded map canvas did not lay out');
  await page.mouse.click(
    expandedCanvasBox.x + expandedCanvasBox.width / 2,
    expandedCanvasBox.y + expandedCanvasBox.height / 2,
  );
  const chartOpenedPanel = page.getByRole('complementary', { name: 'Tides' });
  await expect(chartOpenedPanel).toBeVisible();
  await expect(chartOpenedPanel.getByRole('button', { name: 'Back to menu' })).toHaveCount(0);

  await expect
    .poll(() => page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth + 1))
    .toBe(true);
  const accessibility = await new AxeBuilder({ page })
    .include('aside[aria-label="Tides"]')
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

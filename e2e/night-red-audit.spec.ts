import { expect, type Page, test } from '@playwright/test';
import { nightRedOffendingPixels, openMenuItem, stubVesselsSelf, switchToTheme } from './helpers';

test.use({ serviceWorkers: 'block' });

// Night-red is red on true black. A browser-drawn control once painted gray boxes into the Layers
// list; this audit reads every panel pixel instead of trusting the tokens alone.
async function nightRed(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('binnacle:help-orientation', 'true'));
  await stubVesselsSelf(page);
  await page.goto('/');
  await switchToTheme(page, 'night-red');
}

for (const [menu, tab] of [
  ['Layers and charts', undefined],
  ['Layers and charts', 'Overlays'],
  ['Alarms', undefined],
  ['Routes', undefined],
  ['Display', undefined],
] as const) {
  test(`night-red ${menu}${tab ? ` ${tab}` : ''} panel has no gray or blue pixels`, async ({
    page,
  }) => {
    await nightRed(page);
    await openMenuItem(page, new RegExp(`^${menu}`));
    if (tab) await page.getByRole('button', { name: tab, exact: true }).click();
    const panel = page.locator('.slide-over:visible').last();
    await expect(panel).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await nightRedOffendingPixels(page, await panel.screenshot())).toEqual([]);
  });
}

test.describe('forced colors', () => {
  test.use({ forcedColors: 'active' });

  test('drawn controls fall back to a native, square control', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('binnacle:help-orientation', 'true'));
    await stubVesselsSelf(page);
    await page.goto('/');
    await openMenuItem(page, /^Layers and charts/);
    const control = page.locator('.slide-over input[type="checkbox"]').first();
    await expect(control).toBeVisible();
    expect(await control.evaluate((el) => getComputedStyle(el).appearance)).toBe('auto');
    const box = await control.boundingBox();
    expect(Math.abs((box?.width ?? 0) - (box?.height ?? 0))).toBeLessThan(2);
  });
});

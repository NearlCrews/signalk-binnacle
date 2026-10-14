import { expect, type Page, test } from '@playwright/test';
import { openMenuItem, stubVesselsSelf } from './helpers';

test.use({ serviceWorkers: 'block' });

// Night-red is red on true black. A browser-drawn control once painted gray boxes into the Layers
// list; this audit reads every panel pixel instead of trusting the tokens alone.
async function nightRed(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('binnacle:help-orientation', 'true'));
  await stubVesselsSelf(page);
  await page.goto('/');
  // The active starter profile applies its own theme on boot, so switch through the toolbar.
  for (let i = 0; i < 3; i += 1) {
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) === 'night-red') break;
    await page.getByRole('button', { name: /^Switch theme/ }).click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night-red');
}

// Counts pixels that carry blue or read as neutral gray. Antialiased red on black stays red, so
// the blue rule has a small tolerance for compression noise only.
async function offendingPixels(page: Page, png: Buffer): Promise<string[]> {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, image.width, image.height);
    const bad: string[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
      const blue = b > 12;
      const gray = r > 24 && Math.abs(r - g) < 12 && Math.abs(r - b) < 12;
      if ((blue || gray) && bad.length < 10) {
        const pixel = i / 4;
        bad.push(`${pixel % image.width},${Math.floor(pixel / image.width)} rgb(${r} ${g} ${b})`);
      }
    }
    return bad;
  }, png.toString('base64'));
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
    expect(await offendingPixels(page, await panel.screenshot())).toEqual([]);
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

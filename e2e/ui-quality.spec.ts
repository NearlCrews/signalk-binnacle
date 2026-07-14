import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('restores night-red before interaction and updates browser chrome', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('binnacle:theme', 'night-red');
  });
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night-red');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#000000');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
});

test('keeps primary phone controls touch-sized without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  for (const control of await page.locator('header button:visible').all()) {
    const box = await control.boundingBox();
    if (!box) continue;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
  await expect
    .poll(() => page.locator('body').evaluate((body) => body.scrollWidth <= body.clientWidth + 1))
    .toBe(true);
});

test('keeps chart controls legible and the instrument title on one line', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  const attribution = page.locator('.maplibregl-ctrl-attrib-button');
  await expect(attribution).toHaveCSS('background-image', 'none');
  await expect
    .poll(() => attribution.evaluate((button) => getComputedStyle(button, '::after').maskSize))
    .toBe('20px 20px');
  const scale = page.locator('.maplibregl-ctrl-scale');
  await expect
    .poll(() => scale.evaluate((element) => getComputedStyle(element, '::before').content))
    .toBe('"Scale"');
  await expect(scale).toHaveCSS('display', 'flex');
  await expect(scale).toHaveCSS('flex-direction', 'column');
  await expect
    .poll(() =>
      scale.evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth + 1 &&
          element.scrollHeight <= element.clientHeight + 1,
      ),
    )
    .toBe(true);
  await expect(page.locator('.maplibregl-ctrl-top-right button')).toHaveCount(2);
  await expect(page.locator('.maplibregl-ctrl-bottom-right')).toHaveCSS('bottom', '12px');

  const pinnedInstruments = page.getByRole('button', { name: 'Instruments', exact: true }).first();
  if (await pinnedInstruments.isVisible()) {
    await pinnedInstruments.click();
  } else {
    await page.getByRole('button', { name: 'Menu' }).click();
    await page
      .locator('#app-menu-launcher')
      .getByRole('button', { name: 'Instruments', exact: true })
      .click();
  }
  const heading = page.getByRole('heading', { name: 'Instruments', exact: true });
  await expect(heading).toBeVisible();
  await expect
    .poll(() =>
      heading.evaluate((element) => {
        const textRange = document.createRange();
        textRange.selectNodeContents(element);
        return textRange.getClientRects().length;
      }),
    )
    .toBe(1);
  await expect(page.getByRole('button', { name: 'Customize instruments' })).toHaveText('Customize');
  await expect
    .poll(async () => {
      const [mapBox, scaleBox] = await Promise.all([
        page.locator('.maplibregl-map').boundingBox(),
        scale.boundingBox(),
      ]);
      if (!mapBox || !scaleBox) return false;
      return scaleBox.x + scaleBox.width <= mapBox.x + mapBox.width;
    })
    .toBe(true);
});

test('honors reduced motion and keeps menu keyboard focus contained', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');

  const menuButton = page.getByRole('button', { name: 'Menu' });
  await menuButton.click();
  const menu = page.locator('#app-menu-launcher');
  const first = menu.getByRole('button').first();
  await first.focus();
  await page.keyboard.press('Tab');
  await expect(menu.locator(':focus')).toHaveCount(1);
  await expect(first).toHaveCSS('transition-duration', /1e-05s|0\.00001s|0\.01ms/);
});

test('has no serious or critical automated accessibility violations', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);
});

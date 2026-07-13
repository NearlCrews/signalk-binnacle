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

import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  expectHelmHitTarget,
  expectInsideViewport,
  expectNoHorizontalOverflow,
  FIXTURE_ORIGIN,
  FIXTURE_SERVER,
  openMenuItem,
  stubVesselsSelf,
  waitForSignalKConnection,
} from './helpers';

async function sendValues(
  page: Page,
  values: Array<{ path: string; value: unknown }>,
): Promise<void> {
  const response = await page.request.post(`${FIXTURE_SERVER}/__fixture__/delta`, {
    data: { updates: [{ timestamp: new Date().toISOString(), values }] },
  });
  expect(response.ok()).toBe(true);
}

async function boot(page: Page): Promise<void> {
  const reset = await page.request.post(`${FIXTURE_SERVER}/__fixture__/reset`, { data: {} });
  expect(reset.ok()).toBe(true);
  await stubVesselsSelf(page);
  await page.route(
    /^https?:\/\/(?:[^/]+\.)?(?:open-meteo\.com|rainviewer\.com|weather\.gov)(?:[/:?#]|$)/,
    (route) => route.fulfill({ status: 503 }),
  );
  await page.addInitScript(() => localStorage.clear());
  await page.goto(FIXTURE_ORIGIN);
  await waitForSignalKConnection(page);
  await sendValues(page, [
    { path: 'navigation.position', value: { latitude: 27.7, longitude: -82.7 } },
    { path: 'environment.mode', value: 'day' },
  ]);
}

async function raiseMob(page: Page): Promise<Locator> {
  await sendValues(page, [
    {
      path: 'notifications.mob',
      value: {
        state: 'emergency',
        method: ['visual', 'sound'],
        message: 'Man overboard',
        position: { latitude: 27.701, longitude: -82.701 },
      },
    },
  ]);
  const rail = page.getByRole('complementary', { name: 'Man overboard' });
  await expect(rail).toBeVisible();
  return rail;
}

test('keeps alarm thresholds unchanged after blank edits and uses server feet for off-course limits', async ({
  page,
}) => {
  await page.route('**/signalk/v1/unitpreferences/active', (route) =>
    route.fulfill({ json: { categories: { length: { targetUnit: 'foot' } } } }),
  );
  await boot(page);
  await openMenuItem(page, 'Alarms');
  const shallow = page.getByRole('spinbutton', { name: 'Shallow water depth threshold' });
  const original = await shallow.inputValue();
  await shallow.fill('');
  await page.getByRole('heading', { name: 'Shallow water alarm', exact: true }).click();
  await expect(shallow).toHaveValue(original);
  const offCourse = page.getByRole('spinbutton', { name: 'Off-course alarm limit' });
  await expect(offCourse.locator('..')).toContainText('ft');
  const limit = await offCourse.inputValue();
  await offCourse.fill('');
  await shallow.focus();
  await expect(offCourse).toHaveValue(limit);
  await offCourse.fill('100');
  await shallow.focus();
  await expect(offCourse).toHaveValue('100');
});

test('holds an off-course breach, follows a server alarm, and clears after recovery', async ({
  page,
}) => {
  await boot(page);
  const readings = (xte: number) => [
    { path: 'navigation.position', value: { latitude: 27.7, longitude: -82.7 } },
    { path: 'navigation.course.calcValues.crossTrackError', value: xte },
  ];
  await sendValues(page, [
    ...readings(150),
    {
      path: 'navigation.course.nextPoint',
      value: { position: { latitude: 27.8, longitude: -82.7 }, name: 'Fixture destination' },
    },
    {
      path: 'navigation.course.previousPoint',
      value: { position: { latitude: 27.6, longitude: -82.7 } },
    },
  ]);
  const metric = page
    .getByRole('complementary', { name: 'Active route' })
    .locator('[title^="Cross-track error:"]');
  await expect(metric).toBeVisible();
  await expect(metric).not.toHaveAttribute('title', /past the off-course alarm limit/);
  // Refresh the real stream while the activation grace and held-breach window elapse. This
  // exercises the same clock and freshness gates as a live course, without mocking worker time.
  await expect
    .poll(
      async () => {
        await sendValues(page, readings(150));
        return metric.getAttribute('title');
      },
      { timeout: 45_000, intervals: [1_000] },
    )
    .toContain('past the off-course alarm limit');
  await sendValues(page, [
    {
      path: 'notifications.navigation.course.calcValues.crossTrackError',
      value: { state: 'alarm', method: ['visual', 'sound'], message: 'Fixture off-course alarm' },
    },
  ]);
  await openMenuItem(page, /^Alarms(?:\s*,\s*\d+ active alarms?)?$/);
  const offCourse = page.getByRole('region', { name: 'Off-course alarm', exact: true });
  await expect(offCourse).toContainText('A server plugin raises the off-course alarm.');
  await expect(offCourse).toContainText('settings below apply only to the local fallback');
  await expect(
    offCourse.getByRole('button', { name: 'Mute local off-course fallback' }),
  ).toBeVisible();
  await expect(
    offCourse.getByRole('spinbutton', { name: 'Local fallback off-course alarm limit' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close alarms panel' }).click();
  await sendValues(page, [
    ...readings(0),
    {
      path: 'notifications.navigation.course.calcValues.crossTrackError',
      value: { state: 'normal', method: [], message: 'Recovered' },
    },
  ]);
  await expect(metric).not.toHaveAttribute('title', /past the off-course alarm limit/);
});

test('exposes the emergency action inside phone Trends keyboard scope', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await boot(page);
  await openMenuItem(page, 'Data trends');
  const panel = page
    .locator('.slide-over')
    .filter({ has: page.getByRole('heading', { name: 'Data trends', exact: true }) });
  const mob = panel.getByRole('button', { name: 'Mark man overboard here' });
  await expectInsideViewport(mob, page);
  await expectHelmHitTarget(mob);
  await mob.focus();
  await page.keyboard.press('Enter');
  await expect(
    page
      .getByRole('alertdialog', { name: 'Man overboard' })
      .getByRole('button', { name: 'Mark man overboard', exact: true }),
  ).toBeVisible();
});

test('requires administrator logbook access and retains edits made during a pending save', async ({
  page,
}) => {
  let authorized = false;
  let release: (() => Promise<void>) | undefined;
  let submitted: unknown;
  await page.route('**/plugins/signalk-logbook/logs', async (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    if (!authorized) {
      await route.fulfill({ status: 403 });
      return;
    }
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      await new Promise<void>((resolve) => {
        release = async () => {
          await route.fulfill({ status: 201, json: {} });
          resolve();
        };
      });
    } else await route.fulfill({ json: [] });
  });
  await boot(page);
  await openMenuItem(page, 'Logbook');
  await expect(
    page.getByText('This logbook requires a Signal K administrator browser session.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to Signal K' })).toHaveAttribute(
    'href',
    /\/admin\/#\/login\?redirect=/,
  );
  authorized = true;
  await page.getByRole('button', { name: 'Check again', exact: true }).click();
  const entry = page.getByRole('textbox', { name: 'Entry text' });
  await entry.fill('First entry');
  await page.getByRole('button', { name: 'Add entry', exact: true }).click();
  await expect.poll(() => release !== undefined).toBe(true);
  await entry.fill('Next entry');
  if (!release) throw new Error('Missing pending logbook request');
  await release();
  await expect(page.getByRole('button', { name: 'Add entry', exact: true })).toBeEnabled();
  await expect(entry).toHaveValue('Next entry');
  expect(submitted).toMatchObject({ text: 'First entry' });
});

test('keeps alarm actions reachable with maximum dimming and touch lock', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await boot(page);
  await openMenuItem(page, 'Display Dim, auto theme, text size');
  await page.getByRole('slider', { name: 'Dim level' }).evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '0.85';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Close display panel' }).click();
  await expect(page.locator('.dim-overlay')).toHaveCSS('opacity', '0.85');
  await expect(page.locator('.dim-overlay')).toHaveCSS('pointer-events', 'none');
  await openMenuItem(page, 'Lock screen');
  const unlock = page.getByRole('button', { name: /Unlock the screen/ });
  await expect(unlock).toBeVisible();
  const rail = await raiseMob(page);
  await expectHelmHitTarget(rail.getByRole('button', { name: 'Acknowledge', exact: true }));
  await rail.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(rail).toContainText('Acknowledged');
  await expect(unlock).toBeVisible();
  await unlock.focus();
  await page.keyboard.down('Enter');
  await expect(unlock).toBeHidden({ timeout: 5_000 });
  await page.keyboard.up('Enter');
});

test('keeps MOB controls reachable when the sunset offer appears in the full phone shell', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await boot(page);
  const rail = await raiseMob(page);
  await sendValues(page, [{ path: 'environment.mode', value: 'night' }]);
  await expect(page.getByText('Sunset. Switch to the night theme?')).toBeVisible();
  for (const label of ['Steer to MOB', 'Acknowledge', 'Cancel']) {
    const action = rail.getByRole('button', { name: label, exact: true });
    await expectInsideViewport(action, page);
    await expectHelmHitTarget(action);
  }
  await expectNoHorizontalOverflow(page.locator('body'));
});

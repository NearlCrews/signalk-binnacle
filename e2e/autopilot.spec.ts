import { expect, type Page, test } from '@playwright/test';
import {
  expectNoHorizontalOverflow,
  FIXTURE_ORIGIN,
  FIXTURE_SERVER,
  openMenuItem,
  stubVesselsSelf,
  waitForSignalKConnection,
} from './helpers';

const PILOTS = '/signalk/v2/api/vessels/self/autopilots';

async function bootAutopilot(page: Page, engagement: boolean | null = true) {
  const writes: Array<{ device: string; action: string; body: unknown }> = [];
  const modes = new Map([
    ['pypilot', 'compass'],
    ['backup', 'gps'],
  ]);
  await page.request.post(`${FIXTURE_SERVER}/__fixture__/reset`, { data: {} });
  await stubVesselsSelf(page);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4174\/)/, (route) => route.abort());
  await page.route('**/signalk/v2/features?enabled=1', (route) =>
    route.fulfill({ json: { apis: ['autopilot'], plugins: [] } }),
  );
  await page.route(`**${PILOTS}**`, async (route) => {
    const request = route.request();
    const suffix = new URL(request.url()).pathname.slice(PILOTS.length + 1);
    if (!suffix) {
      await route.fulfill({
        json: {
          pypilot: { provider: 'fixture', isDefault: true },
          backup: { provider: 'fixture', isDefault: false },
        },
      });
      return;
    }
    const [device, ...parts] = suffix.split('/');
    const action = parts.join('/');
    if (request.method() !== 'GET') {
      const body = request.postDataJSON() as { value?: unknown } | null;
      writes.push({ device, action, body });
      if (action === 'mode' && typeof body?.value === 'string') modes.set(device, body.value);
      await route.fulfill({ json: { state: 'COMPLETED', statusCode: 200 } });
      return;
    }
    await route.fulfill({
      json: {
        options: {
          states: [
            { name: 'auto', engaged: true },
            { name: 'standby', engaged: false },
          ],
          modes: ['compass', 'gps', 'wind'],
          actions: [{ id: 'tack', name: 'Tack', available: true }],
        },
        target: 1.5,
        mode: modes.get(device),
        state: engagement === null ? 'unrecognized' : engagement ? 'auto' : 'standby',
        ...(engagement === null ? {} : { engaged: engagement }),
      },
    });
  });
  await page.addInitScript(() => localStorage.clear());
  await page.goto(FIXTURE_ORIGIN);
  await waitForSignalKConnection(page);
  await openMenuItem(page, 'Autopilot');
  const panel = page
    .locator('.slide-over')
    .filter({ has: page.getByRole('heading', { name: 'Autopilot', exact: true }) });
  await expect(panel.getByLabel('Command this pilot')).toHaveValue('pypilot');
  return { writes, panel };
}

test('confirms engaged mode changes for the selected pilot and degrades honestly when the stream drops', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { panel, writes } = await bootAutopilot(page);
  await expect(panel.getByText('The autopilot is engaged and steering.')).toBeVisible();
  await panel.getByRole('button', { name: 'Wind', exact: true }).click();
  await expect(
    panel.getByText("Change pypilot's engaged steering from Compass to Wind?"),
  ).toBeVisible();
  expect(writes).toHaveLength(0);
  await panel.getByLabel('Command this pilot').selectOption('backup');
  await expect(panel.getByRole('button', { name: 'Confirm steering mode change' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'GPS', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(writes).toHaveLength(0);
  await panel.getByRole('button', { name: 'Wind', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm steering mode change' }).click();
  await expect
    .poll(() => writes)
    .toEqual([{ device: 'backup', action: 'mode', body: { value: 'wind' } }]);
  await expect(panel.getByRole('button', { name: 'Wind', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectNoHorizontalOverflow(panel);
  await page.request.post(`${FIXTURE_SERVER}/__fixture__/close-streams`, { data: {} });
  await expect(panel.getByText(/Autopilot state lost/)).toBeVisible();
  await expect(panel.getByText('The autopilot is on standby: hand steering.')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Ten degrees to port' })).toBeDisabled();
  await expect(
    panel.getByRole('button', { name: 'Disengage autopilot', exact: true }),
  ).toBeEnabled();
});

test('does not turn missing engagement into standby or enable steering commands', async ({
  page,
}) => {
  const { panel, writes } = await bootAutopilot(page, null);
  await expect(panel.getByText(/Autopilot state unknown/)).toBeVisible();
  await expect(panel.getByText('The autopilot is on standby: hand steering.')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Wind', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Tack port', exact: true })).toBeDisabled();
  await expect(
    panel.getByRole('button', { name: 'Disengage autopilot', exact: true }),
  ).toBeEnabled();
  expect(writes).toHaveLength(0);
});

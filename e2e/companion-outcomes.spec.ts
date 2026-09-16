import { expect, test } from '@playwright/test';
import { openMenuItem, stubVesselsSelf } from './helpers';

test('keeps an advisor run pending until final status and exposes a refusal', async ({ page }) => {
  await stubVesselsSelf(page);
  await page.route('**/signalk/v1/api/vessels/self/notifications/openrouter-companion', (route) =>
    route.fulfill({
      json: {
        health: {
          report: {
            timestamp: new Date().toISOString(),
            value: { state: 'nominal', message: 'Synthetic advisory report.' },
          },
        },
      },
    }),
  );
  let complete = false;
  let refuse = false;
  let writes = 0;
  await page.route(
    '**/signalk/v1/api/vessels/self/plugins/openrouter-companion/health/run',
    (route) => {
      expect(route.request().method()).toBe('PUT');
      expect(route.request().postDataJSON()).toEqual({ value: {} });
      writes += 1;
      return route.fulfill({
        status: 202,
        json: { state: 'PENDING', statusCode: 202, href: '/signalk/v1/requests/advisor-test' },
      });
    },
  );
  await page.route('**/signalk/v1/requests/advisor-test', (route) =>
    route.fulfill({
      json: complete
        ? {
            state: refuse ? 'FAILED' : 'COMPLETED',
            statusCode: refuse ? 409 : 200,
            message: refuse ? 'Budget exhausted.' : 'Synthetic run finished.',
          }
        : { state: 'PENDING', statusCode: 202 },
    }),
  );
  await page.goto('/');
  await openMenuItem(page, 'AI advisor');
  const run = page.getByRole('button', { name: /Run now:/ });
  await expect(run).toBeEnabled();
  await run.click();
  await expect(run).toBeDisabled();
  await page.getByRole('button', { name: 'Close AI advisor panel' }).click();
  await openMenuItem(page, 'AI advisor');
  await expect(run).toBeDisabled();
  expect(writes).toBe(1);
  await expect(page.getByText('Synthetic run finished.')).not.toBeVisible();
  complete = true;
  await expect(page.getByText('Synthetic run finished.')).toBeVisible();
  await expect(run).toBeEnabled();
  refuse = true;
  await run.click();
  await expect(page.getByText('Budget exhausted.')).toBeVisible();
  await expect(run).toBeEnabled();
  expect(writes).toBe(2);
});

import { expect, test } from '@playwright/test';
import { cachedArchive, expectFixtureChart, installChartFixture } from './chart-fixtures';

test('chart readiness follows real tile failure and recovery, not a successful descriptor', async ({
  page,
}) => {
  const fixture = await installChartFixture(page);
  fixture.failTiles = true;
  await page.goto('./');
  await expect(page.locator('.chart-status')).toHaveText('Chart source failed', {
    timeout: 30_000,
  });
  expect(fixture.requests.some((offset) => offset >= 65536)).toBe(true);
  expect((await cachedArchive(page)).blocks).not.toContain(1);
  fixture.failTiles = false;
  await page.reload();
  await expectFixtureChart(page);
  expect((await cachedArchive(page)).blocks).toContain(1);
});

test('replacement archives replace cached generations before their tiles render', async ({
  page,
}) => {
  const fixture = await installChartFixture(page);
  await page.goto('./');
  await expectFixtureChart(page);
  expect((await cachedArchive(page)).validator).toBe('"fixture-v1"');
  fixture.version = 2;
  fixture.requests.length = 0;
  await page.reload();
  await expectFixtureChart(page, 2);
  expect((await cachedArchive(page)).validator).toBe('"fixture-v2"');
  expect(fixture.requests).toContain(65536);
  fixture.offline = true;
  await page.reload();
  await expectFixtureChart(page, 2);
  expect((await cachedArchive(page)).validator).toBe('"fixture-v2"');
});

test('storage denial degrades to session-only charts and does not promise offline reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
  });
  const fixture = await installChartFixture(page);
  await page.goto('./');
  await expectFixtureChart(page);
  fixture.offline = true;
  await page.reload();
  await expect(page.locator('.chart-status')).toHaveText('Chart source failed', {
    timeout: 30_000,
  });
});

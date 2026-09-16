import { expect, test } from '@playwright/test';
import { openMenuItem, stubVesselsSelf } from './helpers';

test('retains logbook entries and a draft through refresh failure, panel changes, recovery, and save', async ({
  page,
}) => {
  await stubVesselsSelf(page);
  const day = '2026-09-16';
  const firstEntry = 'Synthetic watch began at the harbor entrance.';
  const nextEntry = 'Synthetic entry from the other station.';
  const draft = 'Check the eastern approach with the oncoming watch.';
  const entries = [{ datetime: `${day}T10:00:00.000Z`, text: firstEntry }];
  const submitted: string[] = [];
  let failReads = false;

  await page.route(/\/plugins\/signalk-logbook\/logs(?:\/\d{4}-\d{2}-\d{2})?$/, async (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { text: string };
      submitted.push(body.text);
      entries.push({ datetime: `${day}T12:00:00.000Z`, text: body.text });
      await route.fulfill({ status: 201, json: {} });
      return;
    }
    if (failReads) {
      await route.fulfill({ status: 503, json: { message: 'Synthetic refresh outage' } });
      return;
    }
    const listing = new URL(route.request().url()).pathname.endsWith('/logs');
    await route.fulfill({ json: listing ? [day] : entries });
  });

  await page.goto('/');
  await openMenuItem(page, 'Logbook');
  const panel = page.getByRole('complementary', { name: 'Logbook', exact: true });
  const composer = panel.getByRole('textbox', { name: 'Entry text' });
  const refresh = panel.getByRole('button', { name: 'Refresh entries', exact: true });
  const failure = panel.getByText('Could not load recent entries.', { exact: false });
  await expect(panel.getByText(firstEntry, { exact: true })).toBeVisible();
  await expect(refresh).toBeEnabled();
  await composer.fill(draft);

  failReads = true;
  await refresh.click();
  await expect(failure).toBeVisible();
  await expect(panel.getByText(firstEntry, { exact: true })).toBeVisible();
  await expect(composer).toHaveValue(draft);
  await panel.getByRole('button', { name: 'Close logbook panel' }).click();

  await openMenuItem(page, 'Help');
  await expect(page.getByRole('complementary', { name: 'Help and helm setup' })).toBeVisible();
  await page.getByRole('button', { name: 'Close help', exact: true }).click();
  await openMenuItem(page, 'Logbook');
  await expect(composer).toHaveValue(draft);
  await expect(failure).toBeVisible();
  await expect(refresh).toBeEnabled();
  expect(submitted).toEqual([]);

  entries.push({ datetime: `${day}T11:00:00.000Z`, text: nextEntry });
  failReads = false;
  await refresh.click();
  await expect(panel.getByText(nextEntry, { exact: true })).toBeVisible();
  await expect(panel.getByText(firstEntry, { exact: true })).toBeVisible();
  await expect(failure).not.toBeVisible();
  await expect(panel.getByText('Last checked', { exact: false })).toBeVisible();
  await expect(composer).toHaveValue(draft);

  await panel.getByRole('button', { name: 'Add entry', exact: true }).click();
  await expect(composer).toHaveValue('');
  await expect(panel.getByText(draft, { exact: true })).toHaveCount(1);
  expect(submitted).toEqual([draft]);
});

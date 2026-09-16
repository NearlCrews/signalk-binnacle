import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChartsManagementPanel from './ChartsManagementPanel.svelte';
import { fetchManagedCharts } from './charts-management-client';

vi.mock('./charts-management-client', () => ({
  fetchManagedCharts: vi.fn(),
  putChartOverride: vi.fn(),
}));
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.resetAllMocks();
});

describe('Installed charts refresh', () => {
  it('retains accepted cards through a failed refresh and recovers in place', async () => {
    const accepted = {
      charts: [
        {
          identifier: 'coastal',
          fileName: 'coastal.pmtiles',
          name: 'Coastal',
          description: 'Saved chart',
          scale: 10000,
          minzoom: 1,
          maxzoom: 12,
          format: 'pbf',
          override: {},
        },
      ],
      invalid: [],
    };
    vi.mocked(fetchManagedCharts)
      .mockResolvedValueOnce(accepted)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(accepted);
    const target = document.createElement('div');
    document.body.append(target);
    const component = mount(ChartsManagementPanel, {
      target,
      props: {
        adminAccess: true,
        accessUrl: 'https://boat.test/admin/',
        accessState: 'serving',
        companionBase: 'https://boat.test/plugins/signalk-chart-locker',
        onClose: vi.fn(),
        onRetryAccess: vi.fn(),
      },
    });
    cleanups.push(() => {
      void unmount(component);
      target.remove();
    });
    flushSync();
    await vi.waitFor(() => expect(target.querySelectorAll('.chart-card')).toHaveLength(1));
    const refresh = target.querySelector<HTMLButtonElement>('.refresh-button');
    refresh?.click();
    await vi.waitFor(() => expect(target.textContent).toContain('Showing the last accepted list'));
    expect(target.querySelectorAll('.chart-card')).toHaveLength(1);
    expect(
      target.querySelector<HTMLInputElement>('input[aria-label="Display name for coastal.pmtiles"]')
        ?.value,
    ).toBe('Coastal');
    const retry = [...target.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Retry chart list'),
    );
    retry?.click();
    await vi.waitFor(() => expect(fetchManagedCharts).toHaveBeenCalledTimes(3));
    await vi.waitFor(() =>
      expect(target.textContent).not.toContain('Showing the last accepted list'),
    );
    expect(target.querySelectorAll('.chart-card')).toHaveLength(1);
  });
});

import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { ArmedRow } from '$shared/ui';
import type { SavedRegionDto } from './regions-client.js';
import SavedRegionsView from './SavedRegionsView.svelte';

const noop = (): void => {};
const armedDelete = {
  isArmed: () => false,
  arm: noop,
  cancel: noop,
  confirm: noop,
} as unknown as ArmedRow;

function body(region: SavedRegionDto, pollFailed = false): string {
  return render(SavedRegionsView, {
    props: {
      regions: [region],
      loadError: null,
      regionStatus: {},
      regionPollError: pollFailed ? { [region.id]: true } : {},
      pendingRegion: {},
      submitting: false,
      adminAccess: true,
      armedDelete,
      chartLabel: (id) => (id === 'retired-chart' ? 'Retired chart' : 'Base map'),
      onShow: noop,
      onUseTemplate: noop,
      onRedownload: noop,
      onRetryStatus: noop,
    },
  }).body;
}

const savedRegion: SavedRegionDto = {
  id: 'region-1',
  name: 'Passage',
  bbox: [-1, -1, 1, 1],
  sourceIds: ['basemap'],
  minzoom: 1,
  maxzoom: 2,
  createdAt: 1,
  lastDownloadedAt: null,
  bytes: 0,
  status: 'downloading',
  cachedBytes: 0,
  unavailableSourceIds: [],
};

describe('SavedRegionsView', () => {
  it('offers a status retry after a recovery poll loses contact', () => {
    const html = body(savedRegion, true);
    expect(html).toContain('Download status is unavailable');
    expect(html).toContain('Retry status');
    expect(html).not.toContain('Starting download');
  });

  it('shows the at-a-glance area summary on the card, outside the disclosure', () => {
    const html = body({
      ...savedRegion,
      status: 'ready',
      bbox: [-84, 59.5, -83, 60.5],
      minzoom: 6,
      maxzoom: 12,
      sourceIds: ['basemap', 'retired-chart'],
      unavailableSourceIds: ['retired-chart'],
    });
    expect(html).toContain('Coastal detail · 2 charts, 1 unavailable · about 30 by 60 nm');
    expect(html).not.toContain('passage-ready');
  });

  it('explains unavailable chart sources and prevents a doomed re-download', () => {
    const html = body({
      ...savedRegion,
      status: 'ready',
      sourceIds: ['basemap', 'retired-chart'],
      unavailableSourceIds: ['retired-chart'],
    });
    expect(html).toContain('One included chart is no longer available from Chart Locker');
    expect(html).toContain('Retired chart (unavailable)');
    expect(html).toMatch(/aria-label="Download this area again"[^>]*disabled/);
    expect(html).toContain('Adjust a copy');
  });
});

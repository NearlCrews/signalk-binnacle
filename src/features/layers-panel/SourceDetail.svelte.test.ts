import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { UserChartSource, UserCharts } from '$entities/user-charts';
import type { LayerListItem } from '$shared/map';
import SourceDetail from './SourceDetail.svelte';

const url = 'https://charts.example/harbor.pmtiles?style=day&access_token=secret';
const source: UserChartSource = {
  id: 'chart-1',
  name: 'Harbor',
  kind: 'vector',
  origin: { type: 'url', url },
  shareWithServer: false,
  serverCleanupRequired: true,
};
const item: LayerListItem = {
  id: 'chart-source-chart-1',
  title: 'Harbor',
  visible: true,
  opacity: 1,
  supportsOpacity: true,
  pinned: false,
  band: 'bathymetry',
  available: true,
  chart: { identifier: source.id, source: 'user', kind: 'vector', type: 'tileJSON', url },
};
const noop = (): void => {};

function body(writeBlocked: boolean): string {
  return render(SourceDetail, {
    props: {
      item,
      userCharts: {} as UserCharts,
      userSource: source,
      writeBlocked,
      onBack: noop,
    },
  }).body;
}

describe('SourceDetail', () => {
  it('redacts every query value from the visible source URL', () => {
    const html = body(false);

    expect(html).toContain('style=REDACTED');
    expect(html).toContain('access_token=REDACTED');
    expect(html).not.toContain('style=day');
    expect(html).not.toContain('access_token=secret');
  });

  it('blocks legacy cleanup without write access and enables it after reauthorization', () => {
    const blocked = body(true);
    expect(blocked).toContain('needed to remove the legacy server copy');
    expect(blocked).toMatch(/<button[^>]+disabled[^>]*>.*Delete chart/s);

    const writable = body(false);
    expect(writable).not.toContain('needed to remove the legacy server copy');
    expect(writable).not.toMatch(/<button[^>]+disabled[^>]*>.*Delete chart/s);
  });
});

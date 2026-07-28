import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { UserChartSource } from '$entities/user-charts';
import ChartSourceReview from './ChartSourceReview.svelte';

const source: UserChartSource = {
  id: 'chart-1',
  name: 'Harbor',
  kind: 'vector',
  origin: {
    type: 'url',
    url: 'https://charts.example/harbor.pmtiles?style=day&access_token=secret',
  },
  shareWithServer: false,
  minzoom: 2,
  maxzoom: 12,
  layers: ['water'],
};

const noop = (): void => {};

describe('ChartSourceReview', () => {
  it('redacts replacement query values and reports the staged storage choice', () => {
    const html = render(ChartSourceReview, {
      props: {
        source,
        shareWithServer: false,
        showSource: true,
        onShareChange: noop,
      },
    }).body;

    expect(html).toContain('style=REDACTED');
    expect(html).toContain('access_token=REDACTED');
    expect(html).not.toContain('style=day');
    expect(html).not.toContain('access_token=secret');
    expect(html).toContain('This device only');
    expect(html).toContain('may be private');
  });

  it('explains why a shared chart cannot change sharing without write access', () => {
    const html = render(ChartSourceReview, {
      props: {
        source: { ...source, shareWithServer: true },
        shareWithServer: true,
        writeBlocked: true,
        showSpecs: false,
        onShareChange: noop,
      },
    }).body;

    expect(html).toContain('needed to change sharing for this server chart');
    expect(html).toMatch(/<input[^>]+disabled/);
  });
});

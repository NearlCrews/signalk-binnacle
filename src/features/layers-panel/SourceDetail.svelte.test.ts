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

function body(writeBlocked: boolean, userSource: UserChartSource = source): string {
  return render(SourceDetail, {
    props: {
      item,
      userCharts: {} as UserCharts,
      userSource,
      writeBlocked,
      onBack: noop,
    },
  }).body;
}

describe('SourceDetail', () => {
  it('shows an unsupported style chart reason and keeps its query values redacted', () => {
    const styleUrl = 'https://charts.example/style.json?access_token=secret';
    const styleItem: LayerListItem = {
      ...item,
      id: 'chart-style',
      title: 'Provider style',
      available: false,
      unavailableHint:
        'Binnacle lists this style-document chart for compatibility but cannot display it yet.',
      chart: {
        identifier: 'provider-style',
        source: 'server',
        kind: 'style',
        type: 'mapstyleJSON',
        url: styleUrl,
      },
    };
    const html = render(SourceDetail, {
      props: {
        item: styleItem,
        onBack: noop,
      },
    }).body;

    expect(html).toContain('Type');
    expect(html).toContain('Style');
    expect(html).toContain('cannot display it yet');
    expect(html).toContain('access_token=REDACTED');
    expect(html).not.toContain('access_token=secret');
  });

  it('redacts every query value from the visible source URL', () => {
    const html = body(false);

    expect(html).toContain('style=REDACTED');
    expect(html).toContain('access_token=REDACTED');
    expect(html).not.toContain('style=day');
    expect(html).not.toContain('access_token=secret');
  });

  it('blocks legacy cleanup without write access and enables it after reauthorization', () => {
    const blocked = body(true);
    expect(blocked).toContain('needed to remove the remaining server copy');
    expect(blocked).toMatch(/<button[^>]+disabled[^>]*>.*Delete chart/s);

    const writable = body(false);
    expect(writable).not.toContain('needed to remove the remaining server copy');
    expect(writable).not.toMatch(/<button[^>]+disabled[^>]*>.*Delete chart/s);
  });

  it('offers replacement, metadata refresh, and an explicit sharing preference', () => {
    const html = body(false);

    expect(html).toContain('Source maintenance');
    expect(html).toContain('Replace source URL');
    expect(html).toContain('Refresh metadata');
    expect(html).toContain('Share the full chart URL with the Signal K server');
    expect(html).toContain('visibility, opacity, or');
    expect(html).toContain('stacking position');
  });

  it('explains the disabled Name field on a shared chart without write access', () => {
    const html = body(true, { ...source, shareWithServer: true });
    const nameInput = /<input[^>]*aria-label="Chart name"[^>]*>/.exec(html)?.[0] ?? '';

    expect(nameInput).toContain('disabled');
    expect(html).toContain('needed to rename this shared chart');
  });

  it('offers the read/write request beside the blocked rename', () => {
    const html = render(SourceDetail, {
      props: {
        item,
        userCharts: {} as UserCharts,
        userSource: { ...source, shareWithServer: true },
        writeBlocked: true,
        onRequestWriteAccess: noop,
        onBack: noop,
      },
    }).body;

    expect(html).toContain('needed to rename this shared chart');
    expect(html).toContain('Request read and write access');
  });

  it('rests the request control while a request is outstanding', () => {
    const html = render(SourceDetail, {
      props: {
        item,
        userCharts: {} as UserCharts,
        userSource: { ...source, shareWithServer: true },
        writeBlocked: true,
        onRequestWriteAccess: noop,
        requestingWriteAccess: true,
        onBack: noop,
      },
    }).body;

    expect(html).toContain('Requesting access');
    expect(html).toMatch(/<button[^>]+disabled[^>]*>\s*Requesting access/);
  });

  it('leaves the Name field editable and unexplained while writes are allowed', () => {
    const html = body(false, { ...source, shareWithServer: true });
    const nameInput = /<input[^>]*aria-label="Chart name"[^>]*>/.exec(html)?.[0] ?? '';

    expect(nameInput).not.toContain('disabled');
    expect(html).not.toContain('needed to rename this shared chart');
  });

  it('offers deletion while no source write is in flight', () => {
    const html = body(false);

    expect(html).not.toMatch(/<button[^>]+disabled[^>]*>.*Delete chart/s);
  });

  it('keeps repair available for a device-only chart when server writes are blocked', () => {
    const deviceOnly = {
      ...source,
      serverCleanupRequired: undefined,
    };
    const html = body(true, deviceOnly);

    expect(html).toContain('can be repaired locally');
    expect(html).not.toMatch(/<button[^>]+disabled[^>]*>.*Replace source URL/s);
    expect(html).toMatch(/<input[^>]+type="checkbox"[^>]+disabled/);
  });
});

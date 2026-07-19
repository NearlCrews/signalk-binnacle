import { describe, expect, it, vi } from 'vitest';
import { readPmtilesMeta } from '$shared/map';
import {
  cleanUserChartSource,
  isUserChartSource,
  shouldShareUserChart,
  type UserChartSource,
  UserCharts,
  userChartNeedsServerDelete,
  userChartUrlForDisplay,
  userChartUrlHasCredentialQuery,
} from './user-charts.svelte';

// The entity reads PMTiles metadata through $shared/map; stub it so the test does not need a real
// archive. The descriptor's name defaults to this meta name unless the commit overrides it.
vi.mock('$shared/map', () => ({
  readPmtilesMeta: vi.fn(async () => ({
    name: 'Meta name',
    kind: 'vector' as const,
    bounds: [0, 0, 1, 1] as [number, number, number, number],
    minzoom: 0,
    maxzoom: 10,
    vectorLayers: ['water'],
  })),
}));

describe('isUserChartSource', () => {
  const valid = {
    id: 'c1',
    name: 'Chart',
    kind: 'vector',
    origin: { type: 'url', url: 'https://x/y.pmtiles' },
  } satisfies UserChartSource;

  it('accepts a well-formed descriptor', () => {
    expect(isUserChartSource(valid)).toBe(true);
  });

  it('normalizes text, URLs, layers, and unknown fields into a canonical descriptor', () => {
    expect(
      cleanUserChartSource({
        ...valid,
        id: ' c1 ',
        name: ' Chart ',
        origin: { type: 'url', url: 'https://x/y.pmtiles' },
        layers: [' water ', 'water'],
        ignored: true,
      }),
    ).toEqual({
      id: 'c1',
      name: 'Chart',
      kind: 'vector',
      origin: { type: 'url', url: 'https://x/y.pmtiles' },
      shareWithServer: true,
      layers: ['water'],
    });
  });

  it('rejects drifted or malformed descriptors', () => {
    expect(isUserChartSource(null)).toBe(false);
    expect(isUserChartSource({ ...valid, id: 1 })).toBe(false);
    expect(isUserChartSource({ ...valid, kind: 'bitmap' })).toBe(false);
    expect(isUserChartSource({ ...valid, origin: { type: 'url' } })).toBe(false);
    expect(isUserChartSource({ ...valid, origin: { type: 'other' } })).toBe(false);
    expect(isUserChartSource({ ...valid, bounds: [0, 0, Number.NaN, 1] })).toBe(false);
    expect(isUserChartSource({ ...valid, name: 'bad\nname' })).toBe(false);
    expect(
      isUserChartSource({ ...valid, origin: { type: 'url', url: 'file:///chart.pmtiles' } }),
    ).toBe(false);
    expect(isUserChartSource({ ...valid, minzoom: 12, maxzoom: 4 })).toBe(false);
    expect(isUserChartSource({ ...valid, layers: ['ok', 'bad\nlayer'] })).toBe(false);
    expect(isUserChartSource({ ...valid, shareWithServer: 'yes' })).toBe(false);
    expect(
      isUserChartSource({
        ...valid,
        origin: { type: 'url', url: 'https://captain:secret@x/y.pmtiles' },
      }),
    ).toBe(false);
  });

  it('strips URL fragments and migrates ordinary URLs to server sharing', () => {
    expect(
      cleanUserChartSource({
        ...valid,
        origin: { type: 'url', url: 'https://x/y.pmtiles?style=day#private-fragment' },
      }),
    ).toMatchObject({
      origin: { type: 'url', url: 'https://x/y.pmtiles?style=day' },
      shareWithServer: true,
    });
  });

  it.each([
    'token',
    'api_key',
    'apiToken',
    'Authorization',
    'auth-key',
    'client-secret',
    'secret_key',
    'X-Amz-Signature',
    'x-goog-credential',
  ])('detects the credential-like query name %s', (name) => {
    expect(userChartUrlHasCredentialQuery(`https://x/y.pmtiles?${name}=sensitive`)).toBe(true);
  });

  it('does not classify ordinary query controls as credentials', () => {
    expect(userChartUrlHasCredentialQuery('https://x/y.pmtiles?style=day&locale=en')).toBe(false);
  });

  it('redacts credential-like query values for display without hiding ordinary controls', () => {
    expect(
      userChartUrlForDisplay(
        'https://x/y.pmtiles?style=day&access_token=secret&X-Amz-Signature=signed',
      ),
    ).toBe('https://x/y.pmtiles?style=day&access_token=REDACTED&X-Amz-Signature=REDACTED');
  });

  it('migrates credential-like query URLs to local-only unless sharing was explicit', () => {
    const migrated = cleanUserChartSource({
      ...valid,
      origin: { type: 'url', url: 'https://x/y.pmtiles?access_token=sensitive' },
    });
    expect(migrated?.shareWithServer).toBe(false);
    expect(migrated?.serverCleanupRequired).toBe(true);
    expect(migrated && shouldShareUserChart(migrated)).toBe(false);
    expect(migrated && userChartNeedsServerDelete(migrated)).toBe(true);

    expect(
      cleanUserChartSource({
        ...valid,
        origin: { type: 'url', url: 'https://x/y.pmtiles?access_token=sensitive' },
        shareWithServer: true,
      })?.shareWithServer,
    ).toBe(true);
  });

  it('rejects the legacy file origin, so old browser-local file charts drop at load', () => {
    expect(isUserChartSource({ ...valid, origin: { type: 'file', storeId: 's1' } })).toBe(false);
  });

  it('drops invalid persisted descriptors on construction', () => {
    const charts = new UserCharts(
      [
        valid,
        { id: 'bad' },
        { id: 'c2', name: 'Old file', kind: 'vector', origin: { type: 'file', storeId: 's1' } },
      ] as never,
      () => {},
    );
    expect(charts.sources.map((s) => s.id)).toEqual(['c1']);
  });

  it('drops duplicate persisted ids', () => {
    const charts = new UserCharts([valid, { ...valid, name: 'Duplicate' }], () => {});
    expect(charts.sources).toHaveLength(1);
  });
});

describe('UserCharts stage, commit, and remove', () => {
  it('rejects non-network chart URLs before reading metadata', async () => {
    const charts = new UserCharts([], () => {});
    await expect(charts.stageUrl('file:///tmp/chart.pmtiles')).rejects.toThrow(
      'Enter a valid HTTP or HTTPS PMTiles URL.',
    );
  });

  it('stages a URL chart without saving, then commits with the edited name', async () => {
    const charts = new UserCharts([], () => {});
    const draft = await charts.stageUrl('https://example.com/chart.pmtiles');
    // Staging does not save: the source list is still empty.
    expect(charts.sources).toHaveLength(0);
    expect(draft.source.name).toBe('Meta name');
    expect(draft.source.origin).toEqual({ type: 'url', url: 'https://example.com/chart.pmtiles' });
    expect(draft.source.shareWithServer).toBe(true);

    charts.commit(draft, 'My coastal chart');
    expect(charts.sources).toHaveLength(1);
    expect(charts.sources[0].name).toBe('My coastal chart');
  });

  it('rejects authority credentials and removes fragments before reading an archive', async () => {
    const charts = new UserCharts([], () => {});
    await expect(
      charts.stageUrl('https://captain:secret@example.com/chart.pmtiles'),
    ).rejects.toThrow('Enter a valid HTTP or HTTPS PMTiles URL.');

    const draft = await charts.stageUrl('https://example.com/chart.pmtiles#access-token');
    expect(draft.source.origin.url).toBe('https://example.com/chart.pmtiles');
  });

  it('does not surface a signed chart URL from a metadata transport error', async () => {
    vi.mocked(readPmtilesMeta).mockRejectedValueOnce(
      new Error('PMTiles request failed: https://example.com/chart.pmtiles?access_token=secret'),
    );
    const charts = new UserCharts([], () => {});

    await expect(
      charts.stageUrl('https://example.com/chart.pmtiles?access_token=secret'),
    ).rejects.toThrow('Could not read chart metadata.');
  });

  it('defaults a signed URL to local-only and preserves an explicit sharing choice', async () => {
    const charts = new UserCharts([], () => {});
    const draft = await charts.stageUrl('https://example.com/chart.pmtiles?X-Amz-Signature=secret');
    expect(draft.source.shareWithServer).toBe(false);

    charts.commit(draft, 'Shared signed chart', true);
    expect(charts.sources[0].shareWithServer).toBe(true);
  });

  it('falls back to the metadata name when the committed name is blank', async () => {
    const charts = new UserCharts([], () => {});
    const draft = await charts.stageUrl('https://example.com/harbor.pmtiles');
    charts.commit(draft, '   ');
    expect(charts.sources[0].name).toBe('Meta name');
  });

  it('does not save the same staged chart twice', async () => {
    const charts = new UserCharts([], () => {});
    const draft = await charts.stageUrl('https://example.com/harbor.pmtiles');
    charts.commit(draft, 'Harbor');
    expect(() => charts.commit(draft, 'Harbor again')).toThrow('already saved');
  });

  it('persists on commit and on remove', async () => {
    const snapshots: number[] = [];
    const charts = new UserCharts([], (sources) => snapshots.push(sources.length));
    const draft = await charts.stageUrl('https://example.com/a.pmtiles');
    charts.commit(draft, 'A');
    charts.remove(charts.sources[0]?.id ?? '');
    expect(snapshots).toEqual([1, 0]);
  });

  it('fires onAdd on commit and onRemove on remove (the server-sync hooks)', async () => {
    const added: string[] = [];
    const removed: string[] = [];
    const charts = new UserCharts(
      [],
      () => {},
      (source) => added.push(source.id),
      (source) => removed.push(source.id),
    );
    const draft = await charts.stageUrl('https://example.com/x.pmtiles');
    charts.commit(draft, 'X');
    const id = charts.sources[0].id;
    charts.remove(id);
    expect(added).toEqual([id]);
    expect(removed).toEqual([id]);
  });

  it('fires onRename with the updated descriptor, and not for an unknown id', async () => {
    const renamed: Array<{ id: string; name: string }> = [];
    const snapshots: string[][] = [];
    const charts = new UserCharts(
      [],
      (sources) => snapshots.push(sources.map((s) => s.name)),
      undefined,
      undefined,
      (source) => renamed.push({ id: source.id, name: source.name }),
    );
    const draft = await charts.stageUrl('https://example.com/x.pmtiles');
    charts.commit(draft, 'Old name');
    const id = charts.sources[0].id;

    charts.rename(id, 'New name');
    expect(charts.sources[0].name).toBe('New name');
    expect(renamed).toEqual([{ id, name: 'New name' }]);
    // The rename persisted before the callback fired.
    expect(snapshots.at(-1)).toEqual(['New name']);

    charts.rename('missing', 'Ghost');
    expect(renamed).toHaveLength(1);
    expect(snapshots).toHaveLength(2);
  });
});

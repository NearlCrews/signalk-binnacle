import { describe, expect, it, vi } from 'vitest';
import { isUserChartSource, type UserChartSource, UserCharts } from './user-charts.svelte';

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

    charts.commit(draft, 'My coastal chart');
    expect(charts.sources).toHaveLength(1);
    expect(charts.sources[0].name).toBe('My coastal chart');
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

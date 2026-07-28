import { describe, expect, it, vi } from 'vitest';
import type { InstrumentTrendDescriptor } from '$entities/instrument-trend';
import type { HistoryValues } from '$shared/signalk';
import { loadTrendHistory, TREND_RESOLUTION_SECONDS, TREND_WINDOW_SECONDS } from './trends-history';

const descriptor = (
  id: string,
  candidates: string[],
  aggregate: InstrumentTrendDescriptor['aggregate'] = 'average',
): InstrumentTrendDescriptor => ({
  id,
  label: id,
  description: id,
  category: 'navigation',
  candidates: candidates.map((path, index) => ({
    path,
    referenceLabel: `Reference ${index + 1}`,
    minPeriodMs: 1000,
    staleAfterMs: 10_000,
  })),
  aggregate,
  display: 'count',
  metricPrecision: 0,
  imperialPrecision: 0,
});

const values = (columns: HistoryValues['columns'], rows: HistoryValues['rows']): HistoryValues => ({
  from: '2026-07-27T00:00:00Z',
  to: '2026-07-28T00:00:00Z',
  columns,
  rows,
});

describe('loadTrendHistory', () => {
  it('deduplicates requests and maps each descriptor with attribution', async () => {
    const descriptors = [
      descriptor('depth', ['depth.primary', 'depth.fallback']),
      descriptor('other-depth', ['depth.primary']),
      descriptor('wind', ['wind'], 'max'),
    ];
    const fetchValues = vi.fn(async () =>
      values(
        [
          { path: 'depth.primary', method: 'average' },
          { path: 'depth.fallback', method: 'average' },
          { path: 'wind', method: 'max' },
        ],
        [
          ['2026-07-28T00:00:00Z', 4.2, null, 7.1],
          ['2026-07-28T00:05:00Z', null, 5.1, null],
        ],
      ),
    );
    const got = await loadTrendHistory(
      'http://boat',
      'tok',
      { ids: ['qdb'] },
      descriptors,
      undefined,
      { fetchValues },
    );
    expect(fetchValues).toHaveBeenCalledOnce();
    expect(fetchValues).toHaveBeenCalledWith('http://boat', 'tok', {
      paths: ['depth.primary:average', 'depth.fallback:average', 'wind:max'],
      durationSeconds: TREND_WINDOW_SECONDS,
      resolutionSeconds: TREND_RESOLUTION_SECONDS,
      provider: 'qdb',
      signal: undefined,
    });
    expect(got.state).toBe('complete');
    expect(got.series.get('depth')).toMatchObject({
      provider: 'qdb',
      path: 'depth.primary',
      referenceLabel: 'Reference 1',
      values: [4.2, null],
    });
  });

  it('resolves candidate priority before provider order without mixing providers', async () => {
    const fetchValues = vi.fn(
      async (_origin, _token, query): Promise<HistoryValues | undefined> => {
        if (query.provider === 'first') {
          return values(
            [
              { path: 'primary', method: 'average' },
              { path: 'fallback', method: 'average' },
            ],
            [['2026-07-28T00:00:00Z', null, 9]],
          );
        }
        return values(
          [
            { path: 'primary', method: 'average' },
            { path: 'fallback', method: 'average' },
          ],
          [['2026-07-28T00:00:00Z', 4, 8]],
        );
      },
    );
    const got = await loadTrendHistory(
      'http://boat',
      undefined,
      { ids: ['first', 'second'] },
      [descriptor('depth', ['primary', 'fallback'])],
      undefined,
      { fetchValues },
    );
    expect(fetchValues).toHaveBeenCalledTimes(2);
    expect(got.series.get('depth')).toMatchObject({
      provider: 'second',
      path: 'primary',
      values: [4],
    });
  });

  it('isolates a provider failure and marks accepted results partial', async () => {
    const fetchValues = vi.fn(async (_origin, _token, query) =>
      query.provider === 'broken'
        ? undefined
        : values([{ path: 'depth', method: 'average' }], [['2026-07-28T00:00:00Z', 4]]),
    );
    const got = await loadTrendHistory(
      'http://boat',
      undefined,
      { ids: ['broken', 'working'] },
      [descriptor('depth', ['depth'])],
      undefined,
      { fetchValues },
    );
    expect(got.state).toBe('partial');
    expect(got.failedProviders).toEqual(['broken']);
    expect(got.series.get('depth')?.provider).toBe('working');
  });

  it('distinguishes total failure, true empty history, and duplicate columns', async () => {
    const descriptors = [descriptor('depth', ['depth'])];
    const failed = await loadTrendHistory(
      'http://boat',
      undefined,
      { ids: ['qdb'] },
      descriptors,
      undefined,
      { fetchValues: async () => undefined },
    );
    expect(failed.state).toBe('failed');

    const empty = await loadTrendHistory(
      'http://boat',
      undefined,
      { ids: ['qdb'] },
      descriptors,
      undefined,
      { fetchValues: async () => values([{ path: 'depth', method: 'average' }], []) },
    );
    expect(empty.state).toBe('empty');

    const duplicate = await loadTrendHistory(
      'http://boat',
      undefined,
      { ids: ['qdb'] },
      descriptors,
      undefined,
      {
        fetchValues: async () =>
          values(
            [
              { path: 'depth', method: 'average' },
              { path: 'depth', method: 'average' },
            ],
            [['2026-07-28T00:00:00Z', 4, 5]],
          ),
      },
    );
    expect(duplicate.state).toBe('partial');
    expect(duplicate.series.size).toBe(0);
  });

  it('treats missing and method-mismatched requested columns as partial failures', async () => {
    const descriptors = [descriptor('depth', ['depth'])];
    const missing = await loadTrendHistory(
      'http://boat',
      undefined,
      { ids: ['qdb'] },
      descriptors,
      undefined,
      {
        fetchValues: async () =>
          values([{ path: 'other', method: 'average' }], [['2026-07-28T00:00:00Z', 9]]),
      },
    );
    expect(missing.state).toBe('partial');
    expect(missing.series.size).toBe(0);

    const wrongMethod = await loadTrendHistory(
      'http://boat',
      undefined,
      { ids: ['qdb'] },
      descriptors,
      undefined,
      {
        fetchValues: async () =>
          values([{ path: 'depth', method: 'max' }], [['2026-07-28T00:00:00Z', 9]]),
      },
    );
    expect(wrongMethod.state).toBe('partial');
    expect(wrongMethod.series.size).toBe(0);
  });

  it('accepts a single matching column when a provider omits the method echo', async () => {
    const got = await loadTrendHistory(
      'http://boat',
      undefined,
      { ids: ['qdb'] },
      [descriptor('depth', ['depth'])],
      undefined,
      {
        fetchValues: async () =>
          values([{ path: 'depth', method: '' }], [['2026-07-28T00:00:00Z', 4]]),
      },
    );
    expect(got.state).toBe('complete');
    expect(got.series.get('depth')?.values).toEqual([4]);
  });

  it('batches deduplicated requests within the 100-path ceiling for every provider', async () => {
    const many = descriptor(
      'many',
      Array.from({ length: 101 }, (_, index) => `path.${index}`),
    );
    const fetchValues = vi.fn(
      async (
        _origin: string,
        _token: string | undefined,
        _query: { paths: readonly string[]; provider?: string },
      ) => values([], []),
    );
    await loadTrendHistory(
      'http://boat',
      undefined,
      { ids: ['first', 'second'] },
      [many],
      undefined,
      { fetchValues },
    );

    expect(fetchValues).toHaveBeenCalledTimes(4);
    const calls = fetchValues.mock.calls.map(([, , query]) => query);
    expect(calls.every((query) => query.paths.length <= 100)).toBe(true);
    expect(calls.filter((query) => query.provider === 'first')).toHaveLength(2);
    expect(calls.filter((query) => query.provider === 'second')).toHaveLength(2);
  });

  it('propagates cancellation instead of converting it to provider failure', async () => {
    const abort = new AbortController();
    const pending = loadTrendHistory(
      'http://boat',
      undefined,
      { ids: ['qdb'] },
      [descriptor('depth', ['depth'])],
      abort.signal,
      {
        fetchValues: async (_origin, _token, query) =>
          new Promise((_resolve, reject) => {
            query.signal?.addEventListener('abort', () => {
              reject(new DOMException('Canceled', 'AbortError'));
            });
          }),
      },
    );
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

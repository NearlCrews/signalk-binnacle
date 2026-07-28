import { describe, expect, it, vi } from 'vitest';
import type { HistoryProviders, HistoryValues } from '$shared/signalk';
import { SK_PATHS } from '$shared/signalk';
import { loadTimeTravelHistory } from './time-travel-client';
import { timeTravelPreset } from './time-travel-presets';

const providers: HistoryProviders = { ids: ['signalk-questdb'] };

function values(
  rows: HistoryValues['rows'] = [
    ['2026-06-17T00:00:00.000Z', { latitude: 1, longitude: 2 }, 4, 5, 101_300, 2],
  ],
): HistoryValues {
  return {
    from: '2026-06-17T00:00:00.000Z',
    to: '2026-06-17T01:00:00.000Z',
    columns: [
      { path: SK_PATHS.position, method: '' },
      { path: SK_PATHS.depthBelowTransducer, method: 'average' },
      { path: SK_PATHS.windSpeedApparent, method: 'max' },
      { path: SK_PATHS.outsidePressure, method: 'average' },
      { path: SK_PATHS.speedOverGround, method: 'average' },
    ],
    rows,
  };
}

describe('loadTimeTravelHistory', () => {
  it('sends one bounded provider-specific request with the selected preset', async () => {
    const fetchValues = vi.fn().mockResolvedValue(values());
    const signal = new AbortController().signal;
    await loadTimeTravelHistory(
      'http://x',
      't',
      providers,
      { preset: timeTravelPreset('7d'), signal },
      { fetchValues },
    );
    expect(fetchValues).toHaveBeenCalledWith('http://x', 't', {
      paths: [
        SK_PATHS.position,
        `${SK_PATHS.depthBelowTransducer}:average`,
        `${SK_PATHS.windSpeedApparent}:max`,
        `${SK_PATHS.outsidePressure}:average`,
        `${SK_PATHS.speedOverGround}:average`,
      ],
      durationSeconds: 7 * 24 * 60 * 60,
      resolutionSeconds: 5 * 60,
      provider: 'signalk-questdb',
      signal,
    });
  });

  it('returns normalized samples, range, preset, and provider identity', async () => {
    const fetchValues = vi.fn().mockResolvedValue(values());
    const data = await loadTimeTravelHistory(
      'http://x',
      undefined,
      providers,
      { preset: timeTravelPreset('1h') },
      { fetchValues },
    );
    expect(data).toMatchObject({
      provider: 'signalk-questdb',
      from: Date.parse('2026-06-17T00:00:00.000Z'),
      to: Date.parse('2026-06-17T01:00:00.000Z'),
      preset: { id: '1h' },
    });
    expect(data?.samples).toHaveLength(1);
  });

  it('prefers one provider with positions without merging another provider metrics into it', async () => {
    const fetchValues = vi.fn(async (_origin, _token, query) =>
      query.provider === 'metrics'
        ? values([['2026-06-17T00:00:00.000Z', null, 8, 9, 101_500, 3]])
        : values([
            ['2026-06-17T00:00:00.000Z', { latitude: 4, longitude: 5 }, null, null, null, null],
          ]),
    );
    const data = await loadTimeTravelHistory(
      'http://x',
      undefined,
      { ids: ['metrics', 'positions'] },
      { preset: timeTravelPreset('1h') },
      { fetchValues },
    );
    expect(data?.provider).toBe('positions');
    expect(data?.samples[0]).toMatchObject({ lat: 4, lon: 5 });
    expect(data?.samples[0].depth).toBeNull();
  });

  it('tries the accepted provider first on refresh', async () => {
    const fetchValues = vi.fn().mockResolvedValue(values());
    await loadTimeTravelHistory(
      'http://x',
      undefined,
      { ids: ['first', 'accepted'] },
      { preset: timeTravelPreset('24h'), preferredProvider: 'accepted' },
      { fetchValues },
    );
    expect(fetchValues.mock.calls[0][2].provider).toBe('accepted');
  });

  it('returns a valid empty range distinctly from a failed query', async () => {
    const emptyFetch = vi.fn().mockResolvedValue(values([]));
    const empty = await loadTimeTravelHistory(
      'http://x',
      undefined,
      providers,
      { preset: timeTravelPreset('24h') },
      { fetchValues: emptyFetch },
    );
    expect(empty?.samples).toEqual([]);

    const failedFetch = vi.fn().mockResolvedValue(undefined);
    const failed = await loadTimeTravelHistory(
      'http://x',
      undefined,
      providers,
      { preset: timeTravelPreset('24h') },
      { fetchValues: failedFetch },
    );
    expect(failed).toBeUndefined();
  });

  it('rejects an oversized response and stops provider iteration when aborted', async () => {
    const preset = timeTravelPreset('1h');
    const oversized = values(
      Array.from({ length: preset.maxRows + 1 }, (_, index) => [
        new Date(Date.parse('2026-06-17T00:00:00.000Z') + index * 1000).toISOString(),
        { latitude: 1, longitude: 2 },
        1,
        1,
        1,
        1,
      ]),
    );
    const fetchValues = vi.fn().mockResolvedValue(oversized);
    expect(
      await loadTimeTravelHistory('http://x', undefined, providers, { preset }, { fetchValues }),
    ).toBeUndefined();

    const abort = new AbortController();
    abort.abort();
    fetchValues.mockClear();
    expect(
      await loadTimeTravelHistory(
        'http://x',
        undefined,
        { ids: ['one', 'two'] },
        { preset, signal: abort.signal },
        { fetchValues },
      ),
    ).toBeUndefined();
    expect(fetchValues).not.toHaveBeenCalled();
  });
});

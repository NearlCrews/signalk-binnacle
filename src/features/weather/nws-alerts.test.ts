import { describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing';
import { fetchNwsAlertsResult } from './nws-alerts';

function mockFetch(body: unknown, status = 200) {
  return vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(status, body));
}

function feature(over: Record<string, unknown> = {}) {
  return {
    properties: {
      event: 'Gale Warning',
      severity: 'Severe',
      headline: 'Gale Warning issued for coastal waters',
      onset: '2026-08-30T00:00:00Z',
      ends: '2026-08-31T00:00:00Z',
      effective: '2026-08-29T18:00:00Z',
      expires: '2026-08-30T18:00:00Z',
      description: 'Southwest winds 25 to 35 kt expected.',
      ...over,
    },
  };
}

describe('fetchNwsAlertsResult', () => {
  it('maps active alerts into the provider warning shape with an NWS source', async () => {
    const fetchFn = mockFetch({ features: [feature()] });
    const result = await fetchNwsAlertsResult(27.71239, -82.69457, fetchFn);

    expect(result).toEqual({
      status: 'success',
      value: [
        {
          startTime: '2026-08-30T00:00:00Z',
          endTime: '2026-08-31T00:00:00Z',
          details: 'Gale Warning issued for coastal waters',
          source: 'NWS',
          type: 'Gale Warning',
        },
      ],
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.weather.gov/alerts/active?point=27.7124,-82.6946');
    expect((init as RequestInit).headers).toEqual({ accept: 'application/geo+json' });
  });

  it('falls back from onset to effective and from ends to expires', async () => {
    const fetchFn = mockFetch({ features: [feature({ onset: null, ends: null })] });
    const result = await fetchNwsAlertsResult(27.7, -82.7, fetchFn);

    expect(result).toMatchObject({
      status: 'success',
      value: [{ startTime: '2026-08-29T18:00:00Z', endTime: '2026-08-30T18:00:00Z' }],
    });
  });

  it('collapses and clips a multi-line description when the headline is absent', async () => {
    const fetchFn = mockFetch({
      features: [feature({ headline: null, description: `Line one\nLine two ${'x'.repeat(600)}` })],
    });
    const result = await fetchNwsAlertsResult(27.7, -82.7, fetchFn);

    if (result.status !== 'success') throw new Error(`expected success, got ${result.status}`);
    expect(result.value[0].details.startsWith('Line one Line two ')).toBe(true);
    expect(result.value[0].details).toHaveLength(512);
  });

  it('caps at 20 alerts, keeping the most severe', async () => {
    const minors = Array.from({ length: 24 }, (_, index) =>
      feature({ severity: 'Minor', event: `Advisory ${index}` }),
    );
    const fetchFn = mockFetch({
      features: [...minors, feature({ severity: 'Extreme', event: 'Hurricane Warning' })],
    });
    const result = await fetchNwsAlertsResult(27.7, -82.7, fetchFn);

    if (result.status !== 'success') throw new Error(`expected success, got ${result.status}`);
    expect(result.value).toHaveLength(20);
    expect(result.value[0].type).toBe('Hurricane Warning');
  });

  it('skips an alert without a usable time window while mapping the rest', async () => {
    const fetchFn = mockFetch({
      features: [feature({ onset: null, effective: null, sent: null }), feature()],
    });
    const result = await fetchNwsAlertsResult(27.7, -82.7, fetchFn);

    if (result.status !== 'success') throw new Error(`expected success, got ${result.status}`);
    expect(result.value).toHaveLength(1);
  });

  it('reads an answered empty list as a real all-clear', async () => {
    expect(await fetchNwsAlertsResult(27.7, -82.7, mockFetch({ features: [] }))).toEqual({
      status: 'empty',
    });
  });

  it.each([400, 404])('reads a %d as out of coverage, never as an all-clear', async (status) => {
    expect(await fetchNwsAlertsResult(48.85, 2.35, mockFetch({}, status))).toEqual({
      status: 'unsupported',
    });
  });

  it.each([
    ['a server error', mockFetch({}, 500)],
    ['a network failure', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))],
    ['a malformed body', mockFetch({ alerts: [] })],
    [
      'features that all fail to map',
      mockFetch({ features: [feature({ onset: null, effective: null, sent: null, ends: null })] }),
    ],
  ])('keeps the stale grammar on %s', async (_label, fetchFn) => {
    expect(await fetchNwsAlertsResult(27.7, -82.7, fetchFn)).toEqual({ status: 'failure' });
  });

  it('refuses invalid coordinates without fetching', async () => {
    const fetchFn = mockFetch({ features: [] });
    expect(await fetchNwsAlertsResult(91, 0, fetchFn)).toEqual({ status: 'failure' });
    expect(await fetchNwsAlertsResult(0, 181, fetchFn)).toEqual({ status: 'failure' });
    expect(await fetchNwsAlertsResult(Number.NaN, 0, fetchFn)).toEqual({ status: 'failure' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

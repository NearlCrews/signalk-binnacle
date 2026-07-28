import { describe, expect, it } from 'vitest';
import type { HistoryValues } from '$shared/signalk';
import { SK_PATHS } from '$shared/signalk';
import {
  formatTimeTravelTimestamp,
  nearestSample,
  nearestSampleWithin,
  nextPlaybackSample,
  positionedTrackSegments,
  previousPlaybackSample,
  relativeTimeText,
  scrubValueText,
  toSamples,
} from './time-travel-timeline';

function values(rows: HistoryValues['rows']): HistoryValues {
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

describe('toSamples', () => {
  it('maps one row to one sample, resolving columns by path', () => {
    const samples = toSamples(
      values([
        ['2026-06-17T00:00:00.000Z', { latitude: 10, longitude: 20 }, 4.2, 6.1, 101300, 2.5],
      ]),
    );
    expect(samples).toHaveLength(1);
    expect(samples?.[0]).toMatchObject({
      t: Date.parse('2026-06-17T00:00:00.000Z'),
      lat: 10,
      lon: 20,
      depth: 4.2,
      windApparent: 6.1,
      pressure: 101300,
      sog: 2.5,
    });
  });

  it('skips rows with an unparseable timestamp', () => {
    const samples = toSamples(
      values([
        ['not-a-date', { latitude: 1, longitude: 2 }, 1, 1, 1, 1],
        ['2026-06-17T00:01:00.000Z', { latitude: 3, longitude: 4 }, 1, 1, 1, 1],
      ]),
    );
    expect(samples).toHaveLength(1);
    expect(samples?.[0].lat).toBe(3);
  });

  it('keeps the sample but leaves position undefined for a null position cell', () => {
    const samples = toSamples(values([['2026-06-17T00:00:00.000Z', null, 4.2, null, null, null]]));
    expect(samples?.[0].lon).toBeUndefined();
    expect(samples?.[0].lat).toBeUndefined();
    expect(samples?.[0].depth).toBe(4.2);
    expect(samples?.[0].windApparent).toBeNull();
  });

  it('sorts, filters to the accepted range, and keeps the last duplicate timestamp', () => {
    const samples = toSamples(
      values([
        ['2026-06-17T00:02:00.000Z', { latitude: 3, longitude: 4 }, 3, null, null, null],
        ['2026-06-16T23:59:00.000Z', { latitude: 1, longitude: 2 }, 1, null, null, null],
        ['2026-06-17T00:01:00.000Z', { latitude: 2, longitude: 3 }, 2, null, null, null],
        ['2026-06-17T00:01:00.000Z', { latitude: 8, longitude: 9 }, 8, null, null, null],
      ]),
      {
        fromMs: Date.parse('2026-06-17T00:00:00.000Z'),
        toMs: Date.parse('2026-06-17T00:02:00.000Z'),
        maxRows: 4,
      },
    );
    expect(samples?.map((sample) => sample.t)).toEqual([
      Date.parse('2026-06-17T00:01:00.000Z'),
      Date.parse('2026-06-17T00:02:00.000Z'),
    ]);
    expect(samples?.[0].lat).toBe(8);
  });

  it('rejects a response beyond the preset row cap instead of truncating it', () => {
    expect(
      toSamples(
        values([
          ['2026-06-17T00:00:00.000Z', { latitude: 1, longitude: 2 }],
          ['2026-06-17T00:01:00.000Z', { latitude: 2, longitude: 3 }],
        ]),
        { maxRows: 1 },
      ),
    ).toBeUndefined();
  });
});

describe('nearest lookups', () => {
  const samples = [{ t: 0, lon: 1, lat: 1 }, { t: 1000 }, { t: 2000, lon: 2, lat: 2 }];

  it('nearestSample returns the closest by time', () => {
    expect(nearestSample(samples, 900)?.t).toBe(1000);
  });

  it('nearestSampleWithin rejects an old sample outside the accepted tolerance', () => {
    expect(nearestSampleWithin(samples, 1100, 100)?.t).toBe(1000);
    expect(nearestSampleWithin(samples, 1500, 100)).toBeUndefined();
  });

  it('returns undefined for an empty sample list', () => {
    expect(nearestSample([], 0)).toBeUndefined();
    expect(nearestSampleWithin([], 0, 100)).toBeUndefined();
  });

  it('advances to an accepted sample and stops on the last one', () => {
    expect(nextPlaybackSample(samples, 0, 900)?.t).toBe(1000);
    expect(nextPlaybackSample(samples, 1000, 900)?.t).toBe(2000);
    expect(nextPlaybackSample(samples, 2000, 900)?.t).toBe(2000);
  });

  it('moves backward to an accepted sample and stops on the first one', () => {
    expect(previousPlaybackSample(samples, 2000, 900)?.t).toBe(1000);
    expect(previousPlaybackSample(samples, 1000, 900)?.t).toBe(0);
    expect(previousPlaybackSample(samples, 0, 900)?.t).toBe(0);
  });
});

describe('positionedTrackSegments', () => {
  it('clips at the scrub time and breaks across sparse position gaps', () => {
    const segments = positionedTrackSegments(
      [
        { t: 0, lon: 1, lat: 1 },
        { t: 1_000, lon: 2, lat: 2 },
        { t: 10_000, lon: 3, lat: 3 },
        { t: 11_000, lon: 4, lat: 4 },
        { t: 12_000, lon: 5, lat: 5 },
      ],
      11_000,
      2_000,
    );
    expect(segments).toEqual([
      [
        { t: 0, lon: 1, lat: 1 },
        { t: 1_000, lon: 2, lat: 2 },
      ],
      [
        { t: 10_000, lon: 3, lat: 3 },
        { t: 11_000, lon: 4, lat: 4 },
      ],
    ]);
  });
});

describe('label helpers', () => {
  it('formats an unambiguous local calendar timestamp', () => {
    const label = formatTimeTravelTimestamp(Date.parse('2026-06-17T00:00:00.000Z'));
    expect(label).toContain('2026');
    expect(label).toMatch(/[A-Za-z]/);
  });

  it('uses minute, hour, and day relative labels', () => {
    expect(relativeTimeText(0, 0)).toBe('Newest loaded sample');
    expect(relativeTimeText(60_000, 0)).toBe('1 minute ago');
    expect(relativeTimeText(3_600_000, 0)).toBe('1 hour ago');
    expect(relativeTimeText(3 * 24 * 3_600_000, 0)).toBe('3 days ago');
  });

  it('adds the missing-position qualification to slider text', () => {
    expect(scrubValueText('Wed, Jun 17', '1 hour ago', true)).toBe('Wed, Jun 17, 1 hour ago');
    expect(scrubValueText('Wed, Jun 17', '1 hour ago', false)).toContain(
      'Position unavailable near this time',
    );
  });
});

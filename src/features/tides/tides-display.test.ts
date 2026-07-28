import { describe, expect, it } from 'vitest';
import type { CurrentEvent, TideEvent } from '$entities/tides';
import {
  formatCurrentRate,
  formatStationDistance,
  formatTideHeight,
  formatTideHeightSecondary,
  nextCurrentEvent,
  nowFraction,
  tideCurvePoints,
  tideSourceNote,
  upcomingEvents,
} from './tides-display';

const events: TideEvent[] = [
  { timeMs: 1000, heightMeters: 0.1, kind: 'low' },
  { timeMs: 3000, heightMeters: 0.5, kind: 'high' },
];

describe('tides-display', () => {
  it('puts the preferred height unit first and the other in support', () => {
    expect(formatTideHeight(1.234, 'metric')).toBe('1.23 m');
    expect(formatTideHeightSecondary(1.234, 'metric')).toBe('4.0 ft');
    expect(formatTideHeight(1, 'imperial')).toBe('3.3 ft');
    expect(formatTideHeightSecondary(1, 'imperial')).toBe('1.00 m');
  });

  it('formats the station distance in whole kilometers or miles with a floor', () => {
    expect(formatStationDistance(500, 'metric')).toBe('<1 km');
    expect(formatStationDistance(12_400, 'metric')).toBe('12 km');
    expect(formatStationDistance(1500, 'imperial')).toBe('<1 mi');
    expect(formatStationDistance(12_400, 'imperial')).toBe('8 mi');
  });

  it('formats a current rate in knots from SI m/s', () => {
    expect(formatCurrentRate(0.5144)).toBe('1.0 kn');
  });

  it('returns only upcoming events, soonest first', () => {
    expect(upcomingEvents(events, 2000).map((e) => e.timeMs)).toEqual([3000]);
  });

  it('finds the next non-slack current event after a reference time', () => {
    const currents: CurrentEvent[] = [
      { timeMs: 1000, velocityMps: 0.5, directionRad: (100 * Math.PI) / 180, kind: 'flood' },
      { timeMs: 2000, velocityMps: 0, directionRad: undefined, kind: 'slack' },
      { timeMs: 3000, velocityMps: 0.4, directionRad: (280 * Math.PI) / 180, kind: 'ebb' },
    ];
    expect(nextCurrentEvent(currents, 1500)?.kind).toBe('ebb');
    expect(nextCurrentEvent(currents, 4000)).toBeUndefined();
  });

  it('normalizes tide curve points to a 0..1 box', () => {
    const points = tideCurvePoints(events);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[1]).toEqual({ x: 1, y: 1 });
    expect(tideCurvePoints([])).toEqual([]);
  });

  it('locates now within the span, or undefined outside it', () => {
    expect(nowFraction(events, 2000)).toBeCloseTo(0.5);
    expect(nowFraction(events, 500)).toBeUndefined();
  });

  it('names the source that served the tide prediction, or stays silent without one', () => {
    expect(tideSourceNote('signalk-tides')).toBe(
      'Automatic tide predictions use the signalk-tides plugin. Tidal-current predictions use NOAA CO-OPS.',
    );
    expect(tideSourceNote('noaa-coops')).toBe(
      'Automatic tide and tidal-current predictions use NOAA CO-OPS.',
    );
    expect(
      tideSourceNote('noaa-coops', {
        mode: 'manual',
        station: { id: 'T1', name: 'Tide', latitude: 0, longitude: 0 },
        distanceMeters: 0,
      }),
    ).toContain('manually selected');
    expect(tideSourceNote(undefined)).toBe('');
  });
});

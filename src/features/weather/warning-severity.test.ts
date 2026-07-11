import { describe, expect, it } from 'vitest';
import type { WeatherWarning } from './signalk-weather';
import { activeWarnings, sortWarnings } from './warning-severity';

const warning = (type: string, startTime: string, endTime: string): WeatherWarning => ({
  type,
  startTime,
  endTime,
  details: type,
  source: 'Test',
});

describe('warning severity and active windows', () => {
  it('filters expired, future, and malformed warning windows', () => {
    const now = Date.parse('2026-06-11T12:00:00Z');
    const active = warning('Gale', '2026-06-11T10:00:00Z', '2026-06-11T14:00:00Z');
    expect(
      activeWarnings(
        [
          active,
          warning('Expired', '2026-06-11T08:00:00Z', '2026-06-11T09:00:00Z'),
          warning('Future', '2026-06-11T13:00:00Z', '2026-06-11T15:00:00Z'),
          warning('Malformed', 'bad', 'also bad'),
        ],
        now,
      ),
    ).toEqual([active]);
  });

  it('sorts severe warnings first, then by start time', () => {
    const warnings = [
      warning('Small Craft Advisory', '2026-06-11T11:00:00Z', '2026-06-12T00:00:00Z'),
      warning('Gale Warning', '2026-06-11T12:00:00Z', '2026-06-12T00:00:00Z'),
      warning('Storm Warning', '2026-06-11T13:00:00Z', '2026-06-12T00:00:00Z'),
      warning('Gale Warning', '2026-06-11T10:00:00Z', '2026-06-12T00:00:00Z'),
    ];
    expect(sortWarnings(warnings).map((item) => `${item.type}:${item.startTime}`)).toEqual([
      'Storm Warning:2026-06-11T13:00:00Z',
      'Gale Warning:2026-06-11T10:00:00Z',
      'Gale Warning:2026-06-11T12:00:00Z',
      'Small Craft Advisory:2026-06-11T11:00:00Z',
    ]);
  });
});

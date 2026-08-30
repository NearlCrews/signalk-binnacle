import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import type { UnitsProfile } from '$shared/lib';
import { type RouteWindSample, routeWindAt, windLineText } from './route-weather';

const T0 = Date.parse('2026-08-11T00:00:00Z');
const HOUR = 3_600_000;

// An obviously synthetic two-by-two, three-step grid; nothing here restates an upstream fact.
function makeGrid(overrides: Partial<WeatherGrid> = {}): WeatherGrid {
  const fill = (value: number) => Array.from({ length: 3 }, () => new Array(4).fill(value));
  return {
    lats: [42, 44],
    lons: [-84, -82],
    times: [T0, T0 + HOUR, T0 + 2 * HOUR],
    windU: fill(0),
    windV: fill(-5),
    ...overrides,
  };
}

describe('routeWindAt', () => {
  it('samples a uniform northerly as five meters per second from true north', () => {
    const sample = routeWindAt(makeGrid(), 43, -83, T0 + HOUR / 2);
    expect(sample).toBeDefined();
    expect(sample?.speedMps).toBeCloseTo(5);
    expect(sample?.directionFromRad).toBeCloseTo(0);
    expect(sample?.gustMps).toBeUndefined();
  });

  it('reads an easterly as coming from 090', () => {
    const fill = (value: number) => Array.from({ length: 3 }, () => new Array(4).fill(value));
    const sample = routeWindAt(makeGrid({ windU: fill(-5), windV: fill(0) }), 43, -83, T0);
    expect(sample?.directionFromRad).toBeCloseTo(Math.PI / 2);
  });

  it('blends the two forecast steps bracketing the arrival', () => {
    const windV = [new Array(4).fill(-4), new Array(4).fill(-8), new Array(4).fill(-8)];
    const sample = routeWindAt(makeGrid({ windV }), 43, -83, T0 + HOUR / 2);
    expect(sample?.speedMps).toBeCloseTo(6);
  });

  it('interpolates bilinearly between grid rows', () => {
    const row = (south: number, north: number) => [south, south, north, north];
    const windV = [row(-2, -6), row(-2, -6), row(-2, -6)];
    const sample = routeWindAt(makeGrid({ windV }), 43, -83, T0);
    expect(sample?.speedMps).toBeCloseTo(4);
  });

  it('carries the gust when the grid has one', () => {
    const windGust = Array.from({ length: 3 }, () => new Array(4).fill(10));
    const sample = routeWindAt(makeGrid({ windGust }), 43, -83, T0 + HOUR / 2);
    expect(sample?.gustMps).toBeCloseTo(10);
  });

  it('covers the forecast horizon ends exactly, and nothing beyond them', () => {
    const grid = makeGrid();
    expect(routeWindAt(grid, 43, -83, T0)).toBeDefined();
    expect(routeWindAt(grid, 43, -83, T0 + 2 * HOUR)).toBeDefined();
    expect(routeWindAt(grid, 43, -83, T0 - 1)).toBeUndefined();
    expect(routeWindAt(grid, 43, -83, T0 + 2 * HOUR + 1)).toBeUndefined();
  });

  it('samples nothing outside the grid area', () => {
    const grid = makeGrid();
    expect(routeWindAt(grid, 45, -83, T0)).toBeUndefined();
    expect(routeWindAt(grid, 43, -85, T0)).toBeUndefined();
  });

  it('samples nothing from an empty series', () => {
    expect(routeWindAt(makeGrid({ times: [], windU: [], windV: [] }), 43, -83, T0)).toBeUndefined();
  });

  it('yields nothing when either bracketing step is unforecast, rather than half a blend', () => {
    const nanStep0 = [new Array(4).fill(Number.NaN), new Array(4).fill(-5), new Array(4).fill(-5)];
    const nanStep1 = [new Array(4).fill(-5), new Array(4).fill(Number.NaN), new Array(4).fill(-5)];
    expect(routeWindAt(makeGrid({ windV: nanStep0 }), 43, -83, T0 + HOUR / 2)).toBeUndefined();
    expect(routeWindAt(makeGrid({ windV: nanStep1 }), 43, -83, T0 + HOUR / 2)).toBeUndefined();
  });
});

describe('windLineText', () => {
  const sample: RouteWindSample = { speedMps: 5, directionFromRad: 0, gustMps: 10 };

  it('formats speed, gust, and from-direction in the metric profile (knots)', () => {
    expect(windLineText(sample, 'metric')).toBe('Wind 9.7 kn gust 19.4 from 000');
  });

  it('omits the gust segment when the grid carried none', () => {
    expect(windLineText({ ...sample, gustMps: undefined }, 'metric')).toBe('Wind 9.7 kn from 000');
  });

  it('honors the preference profile speed category', () => {
    const profile: UnitsProfile = {
      length: 'm',
      speed: 'm/s',
      temperature: 'C',
      pressure: 'hPa',
      precip: 'mm/h',
      landDistance: 'km',
    };
    expect(windLineText(sample, profile)).toBe('Wind 5.0 m/s gust 10.0 from 000');
  });
});

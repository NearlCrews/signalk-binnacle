import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { precipUnitLabel, pressureTrendPa, readoutAt, readoutAtBracket } from './weather-readout';

const grid: WeatherGrid = {
  lats: [0, 1],
  lons: [0, 1],
  times: [1000, 4000],
  windU: [
    [-10, -10, -10, -10],
    [0, 0, 0, 0],
  ],
  windV: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  windGust: [
    [15, 15, 15, 15],
    [5, 5, 5, 5],
  ],
  waveDirection: [
    [1, 1, 1, 1],
    [2, 2, 2, 2],
  ],
  pressureMsl: [
    [101300, 101300, 101300, 101300],
    [101300, 101300, 101300, 101300],
  ],
  waveHeight: [
    [1.8, 1.8, 1.8, 1.8],
    [1.8, 1.8, 1.8, 1.8],
  ],
  wavePeriod: [
    [7, 7, 7, 7],
    [7, 7, 7, 7],
  ],
  precipitation: [
    [2, 2, 2, 2],
    [2, 2, 2, 2],
  ],
  cloudCover: [
    [0.8, 0.8, 0.8, 0.8],
    [0.8, 0.8, 0.8, 0.8],
  ],
  swellWaveHeight: [
    [1.2, 1.2, 1.2, 1.2],
    [1.4, 1.4, 1.4, 1.4],
  ],
  swellWavePeakPeriod: [
    [9, 9, 9, 9],
    [11, 11, 11, 11],
  ],
  oceanCurrentSpeed: [
    [0.4, 0.4, 0.4, 0.4],
    [0.6, 0.6, 0.6, 0.6],
  ],
  seaSurfaceTemperature: [
    [288, 288, 288, 288],
    [290, 290, 290, 290],
  ],
};

describe('readoutAt', () => {
  it('returns SI speed and a from-direction at a point', () => {
    const r = readoutAt(grid, 0.5, 0.5, 0);
    expect(r?.speedMs).toBeCloseTo(10, 4);
    expect(r?.fromRad).toBeCloseTo(Math.PI / 2, 4); // wind toward the west comes from the east
    expect(r?.pressurePa).toBeCloseTo(101300, 0);
    expect(r?.waveHeightM).toBeCloseTo(1.8, 4);
    expect(r?.wavePeriodS).toBeCloseTo(7, 4);
    expect(r?.precipitationMm).toBeCloseTo(2, 4);
    expect(r?.cloudCoverFraction).toBeCloseTo(0.8, 4);
    expect(r?.gustMs).toBeCloseTo(15, 4);
    expect(r?.waveFromRad).toBeCloseTo(1, 4);
    expect(r?.swellHeightM).toBeCloseTo(1.2, 4);
    expect(r?.swellPeriodS).toBeCloseTo(9, 4);
    expect(r?.currentSpeedMs).toBeCloseTo(0.4, 4);
    expect(r?.waterTempK).toBeCloseTo(288, 4);
  });
  it('returns undefined outside the grid', () => {
    expect(readoutAt(grid, 9, 9, 0)).toBeUndefined();
  });
});

describe('readoutAtBracket', () => {
  it('blends the two bracketing steps exactly as the drawn fields do', () => {
    const r = readoutAtBracket(grid, 0.5, 0.5, { lo: 0, hi: 1, frac: 0.5 });
    // windU blends -10 toward 0, so the speed is the midpoint, not the lower step's value.
    expect(r?.speedMs).toBeCloseTo(5, 4);
    expect(r?.gustMs).toBeCloseTo(10, 4);
    // The wave direction blends through the shorter arc.
    expect(r?.waveFromRad).toBeCloseTo(1.5, 4);
  });

  it('matches readoutAt at a zero fraction', () => {
    expect(readoutAtBracket(grid, 0.5, 0.5, { lo: 0, hi: 0, frac: 0 })).toEqual(
      readoutAt(grid, 0.5, 0.5, 0),
    );
  });

  it('does not interpolate preceding-hour precipitation totals', () => {
    const stepped = {
      ...grid,
      precipitation: [new Array(4).fill(1), new Array(4).fill(9)],
      precipitationInterpolation: 'step' as const,
    };
    const r = readoutAtBracket(stepped, 0.5, 0.5, { lo: 0, hi: 1, frac: 0.75 });
    expect(r?.precipitationMm).toBe(1);
  });
});

describe('pressureTrendPa', () => {
  const HOUR = 3_600_000;
  const trendGrid: WeatherGrid = {
    lats: [0, 1],
    lons: [0, 1],
    times: [0, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR],
    windU: Array.from({ length: 5 }, () => [0, 0, 0, 0]),
    windV: Array.from({ length: 5 }, () => [0, 0, 0, 0]),
    // Falling 100 Pa (1 hPa) per hour, so the trailing 3-hour change is -300 Pa.
    pressureMsl: Array.from({ length: 5 }, (_, t) => new Array(4).fill(101_500 - t * 100)),
  };

  it('reports the trailing three-hour change', () => {
    expect(pressureTrendPa(trendGrid, 0.5, 0.5, 4 * HOUR)).toBeCloseTo(-300, 4);
  });

  it('refuses a window the series cannot cover', () => {
    // A shorter window must never be passed off as the 3-hour tendency.
    expect(pressureTrendPa(trendGrid, 0.5, 0.5, HOUR)).toBeUndefined();
  });
});

describe('precipUnitLabel', () => {
  it('labels the free grid rate per hour and the provider volume as a bare amount', () => {
    expect(precipUnitLabel(true, 'metric')).toBe('mm/h');
    expect(precipUnitLabel(false, 'metric')).toBe('mm');
    expect(precipUnitLabel(true, 'imperial')).toBe('in/h');
    expect(precipUnitLabel(false, 'imperial')).toBe('in');
  });

  it('treats a missing flag as a volume, the conservative read', () => {
    expect(precipUnitLabel(undefined, 'metric')).toBe('mm');
  });
});

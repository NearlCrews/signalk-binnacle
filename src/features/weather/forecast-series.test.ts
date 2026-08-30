import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { knotsToMetersPerSecond } from '$shared/lib';
import { forecastRiskCues, mergeConditions, pickForecast } from './forecast-series';

const HOUR = 3_600_000;
const kn = knotsToMetersPerSecond;
const grid: WeatherGrid = {
  lats: [0, 1],
  lons: [0, 1],
  times: [0, 3 * HOUR, 6 * HOUR, 9 * HOUR, 12 * HOUR],
  windU: Array.from({ length: 5 }, () => [-5, -5, -5, -5]),
  windV: Array.from({ length: 5 }, () => [0, 0, 0, 0]),
  windGust: Array.from({ length: 5 }, () => [8, 8, 8, 8]),
  pressureMsl: Array.from({ length: 5 }, () => [101_000, 101_000, 101_000, 101_000]),
  waveHeight: Array.from({ length: 5 }, () => [1.5, 1.5, 1.5, 1.5]),
  wavePeriod: Array.from({ length: 5 }, () => [7, 7, 7, 7]),
};

describe('mergeConditions', () => {
  it('applies provider fields over compatible grid fields and tracks mixed provenance', () => {
    const merged = mergeConditions(
      { timeMs: 0, windMs: 5, pressurePa: 100_000, provenance: 'Open-Meteo' },
      { timeMs: HOUR, pressurePa: 101_000, visibilityM: 500, provenance: 'provider' },
    );
    expect(merged).toMatchObject({
      timeMs: HOUR,
      windMs: 5,
      pressurePa: 101_000,
      visibilityM: 500,
      provenance: 'mixed',
    });
  });

  it('does not merge fields at incompatible valid times', () => {
    expect(
      mergeConditions(
        { timeMs: 0, windMs: 5, provenance: 'Open-Meteo' },
        { timeMs: 4 * HOUR, pressurePa: 101_000, provenance: 'provider' },
      ),
    ).toEqual({ timeMs: 4 * HOUR, pressurePa: 101_000, provenance: 'provider' });
  });

  it('reports provider provenance when no grid field survives', () => {
    expect(
      mergeConditions(
        { timeMs: 0, windMs: 5, provenance: 'Open-Meteo' },
        { timeMs: 0, windMs: 8, provenance: 'provider' },
      )?.provenance,
    ).toBe('provider');
  });
});

describe('pickForecast', () => {
  it('sorts provider rows and enriches each row field by field from the grid', () => {
    const result = pickForecast(
      grid,
      [
        { timeMs: 6 * HOUR, visibilityM: 900, provenance: 'provider' },
        { timeMs: 3 * HOUR, pressurePa: 99_000, provenance: 'provider' },
      ],
      [0.5, 0.5],
      0,
      0,
      true,
    );
    expect(result.rows.map((row) => row.timeMs)).toEqual([3 * HOUR, 6 * HOUR]);
    expect(result.rows[0]).toMatchObject({
      windMs: 5,
      gustMs: 8,
      pressurePa: 99_000,
      waveHeightM: 1.5,
      provenance: 'mixed',
    });
    expect(result.rows[1]).toMatchObject({ visibilityM: 900, windMs: 5, provenance: 'mixed' });
  });

  it('falls back to Open-Meteo rows when provider rows are fully in the past', () => {
    const result = pickForecast(
      grid,
      [{ timeMs: 0, pressurePa: 99_000 }],
      [0.5, 0.5],
      3 * HOUR,
      3 * HOUR,
      true,
    );
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((row) => row.provenance === 'Open-Meteo')).toBe(true);
  });

  it('promotes a repeated provider timestamp to one forecast row', () => {
    const result = pickForecast(
      grid,
      [
        { timeMs: 3 * HOUR, pressurePa: 99_000, provenance: 'provider' },
        { timeMs: 3 * HOUR, pressurePa: 99_000, provenance: 'provider' },
      ],
      [0.5, 0.5],
      0,
      0,
      true,
    );

    expect(result.rows.filter(({ timeMs }) => timeMs === 3 * HOUR)).toHaveLength(1);
  });
});

describe('forecastRiskCues', () => {
  it('adds deterministic wind, visibility, pressure, sea-state, and current cues', () => {
    const rows = forecastRiskCues([
      { timeMs: 0, windMs: 18, pressurePa: 101_000 },
      {
        timeMs: 3 * HOUR,
        gustMs: 25,
        pressurePa: 100_300,
        visibilityM: 1000,
        waveHeightM: 2.5,
        currentSpeedMs: 1.5,
      },
    ]);
    expect(rows[0].riskCues).toEqual(['Gale-force wind']);
    expect(rows[1].riskCues).toEqual([
      'Storm-force wind',
      'Dense fog',
      'Rough seas',
      'Strong current',
      'Rapid pressure fall',
    ]);
  });

  it('does not flag values below the restrained thresholds', () => {
    const rows = forecastRiskCues([
      { timeMs: 0, windMs: 17, pressurePa: 101_000 },
      {
        timeMs: 3 * HOUR,
        gustMs: 17,
        pressurePa: 100_500,
        visibilityM: 1001,
        waveHeightM: 2.49,
        currentSpeedMs: 1.49,
        weatherCode: 3,
      },
    ]);
    expect(rows.every((row) => row.riskCues === undefined)).toBe(true);
  });

  it('flags fog from the WMO code even when the cell-averaged visibility sits above the floor', () => {
    const rows = forecastRiskCues([
      { timeMs: 0, visibilityM: 4000, weatherCode: 45 },
      { timeMs: HOUR, visibilityM: 4000, weatherCode: 48 },
    ]);
    expect(rows[0].riskCues).toEqual(['Dense fog']);
    expect(rows[1].riskCues).toEqual(['Dense fog']);
  });

  it('flags squall risk only when the gust ratio and the gust floor both hold', () => {
    const rows = forecastRiskCues([
      { timeMs: 0, windMs: kn(16), gustMs: kn(25) },
      // The ratio alone: a 6 kn breeze gusting 9 is an ordinary afternoon, not a squall.
      { timeMs: HOUR, windMs: kn(6), gustMs: kn(9) },
      // The floor alone: 26 kn gusting over 20 kn wind is under the 1.5 ratio.
      { timeMs: 2 * HOUR, windMs: kn(20), gustMs: kn(26) },
      // A heavy gust with no sustained wind reading cannot grade the ratio.
      { timeMs: 3 * HOUR, gustMs: kn(40) },
    ]);
    expect(rows[0].riskCues).toEqual(['Squall risk']);
    expect(rows[1].riskCues).toBeUndefined();
    expect(rows[2].riskCues).toBeUndefined();
    expect(rows[3].riskCues).toEqual(['Gale-force wind']);
  });

  it('flags steep seas from the height-to-period breaking heuristic', () => {
    const rows = forecastRiskCues([
      // 2 m at 4 s: T^2/13 is 1.23 m, so the sea is steep while still under the rough floor.
      { timeMs: 0, waveHeightM: 2, wavePeriodS: 4 },
      // The same 2 m at 8 s is long, easy swell.
      { timeMs: HOUR, waveHeightM: 2, wavePeriodS: 8 },
      { timeMs: 2 * HOUR, waveHeightM: 2, wavePeriodS: 0 },
      { timeMs: 3 * HOUR, waveHeightM: 3, wavePeriodS: 5 },
    ]);
    expect(rows[0].riskCues).toEqual(['Steep seas']);
    expect(rows[1].riskCues).toBeUndefined();
    expect(rows[2].riskCues).toBeUndefined();
    expect(rows[3].riskCues).toEqual(['Rough seas', 'Steep seas']);
  });

  it('flags wind against current when the wind arrives from where the current flows toward', () => {
    const opposed = {
      windMs: kn(15),
      currentSpeedMs: 0.6,
    };
    const rows = forecastRiskCues([
      // Wind from the north against a current flowing toward the north.
      { timeMs: 0, ...opposed, fromRad: 0.1, currentDirectionRad: 0.2 },
      // The same opposition across the 0/2pi seam.
      { timeMs: HOUR, ...opposed, fromRad: 0.2, currentDirectionRad: 2 * Math.PI - 0.2 },
      // Wind from the south with a north-flowing current runs WITH it: no cue.
      { timeMs: 2 * HOUR, ...opposed, fromRad: Math.PI, currentDirectionRad: 0 },
      // Past the 45 degree alignment window.
      { timeMs: 3 * HOUR, ...opposed, fromRad: 0, currentDirectionRad: Math.PI / 3 },
      // Under the wind floor.
      { timeMs: 4 * HOUR, windMs: kn(9), currentSpeedMs: 0.6, fromRad: 0, currentDirectionRad: 0 },
      // Under the current floor.
      { timeMs: 5 * HOUR, windMs: kn(15), currentSpeedMs: 0.4, fromRad: 0, currentDirectionRad: 0 },
    ]);
    expect(rows[0].riskCues).toEqual(['Wind against current']);
    expect(rows[1].riskCues).toEqual(['Wind against current']);
    expect(rows[2].riskCues).toBeUndefined();
    expect(rows[3].riskCues).toBeUndefined();
    expect(rows[4].riskCues).toBeUndefined();
    expect(rows[5].riskCues).toBeUndefined();
  });
});

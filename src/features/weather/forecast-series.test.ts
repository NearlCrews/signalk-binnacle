import { describe, expect, it } from 'vitest';
import type { WeatherGrid } from '$entities/weather';
import { forecastRiskCues, mergeConditions, pickForecast } from './forecast-series';

const HOUR = 3_600_000;
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
      },
    ]);
    expect(rows.every((row) => row.riskCues === undefined)).toBe(true);
  });
});

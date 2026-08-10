import { describe, expect, it } from 'vitest';
import { requireCatalogSource } from './catalog';
import { chartViewCharts, chartViewStatus } from './chart-view-status';

const center = { latitude: 27.7, longitude: -82.7 };
const covering = { visible: true, bounds: [-83, 27, -82, 28] as [number, number, number, number] };

function status(overrides: Partial<Parameters<typeof chartViewStatus>[0]> = {}) {
  return chartViewStatus({
    baseStyleFallback: false,
    chartsLoadState: 'ready',
    charts: [covering],
    center,
    zoom: 12,
    ...overrides,
  });
}

describe('chartViewStatus', () => {
  it('grades a covering visible chart as active', () => {
    expect(status()).toBe('active');
  });

  it('treats undeclared bounds as worldwide coverage', () => {
    expect(status({ charts: [{ visible: true }] })).toBe('active');
  });

  it('reports reference-only when no chart layer is enabled', () => {
    expect(status({ charts: [] })).toBe('reference-only');
    expect(status({ charts: [{ ...covering, visible: false }] })).toBe('reference-only');
  });

  it('reports source-failed when the chart endpoint failed and nothing is enabled', () => {
    expect(status({ charts: [], chartsLoadState: 'error' })).toBe('source-failed');
  });

  it('keeps grading retained charts through a refresh failure', () => {
    expect(status({ chartsLoadState: 'error' })).toBe('active');
  });

  it('reports out-of-coverage when the view leaves every enabled chart', () => {
    expect(status({ center: { latitude: 0, longitude: 0 } })).toBe('out-of-coverage');
  });

  it('grades below-minzoom views as out of coverage in the zoom dimension', () => {
    expect(status({ charts: [{ ...covering, minzoom: 10 }], zoom: 6 })).toBe('out-of-coverage');
  });

  it('flags overzoom past every covering chart, and clears it when one still has detail', () => {
    expect(status({ charts: [{ ...covering, maxzoom: 14 }], zoom: 16 })).toBe('active-overzoomed');
    expect(
      status({
        charts: [
          { ...covering, maxzoom: 14 },
          { ...covering, maxzoom: 18 },
        ],
        zoom: 16,
      }),
    ).toBe('active');
  });

  it('grades the offline fallback base as base-unavailable above all else', () => {
    expect(status({ baseStyleFallback: true })).toBe('base-unavailable');
  });

  it('stays reference-only while the view is unknown', () => {
    expect(status({ center: undefined })).toBe('reference-only');
    expect(status({ zoom: undefined })).toBe('reference-only');
  });

  it('normalizes an unwrapped center longitude before containment', () => {
    // MapLibre reports an unwrapped longitude after panning across the antimeridian: -82.7 can
    // arrive as 277.3, which must still count as inside a Gulf-coast box.
    expect(status({ center: { latitude: 27.7, longitude: 277.3 } })).toBe('active');
    expect(status({ center: { latitude: 27.7, longitude: -442.7 } })).toBe('active');
  });
});

describe('chartViewCharts', () => {
  it('projects a chart-bearing item onto one entry from its own bounds', () => {
    const charts = chartViewCharts([
      { visible: true, chart: { bounds: [-83, 27, -82, 28], minzoom: 2, maxzoom: 16 } },
      { visible: false },
    ]);
    expect(charts).toEqual([
      { visible: true, bounds: [-83, 27, -82, 28], minzoom: 2, maxzoom: 16 },
    ]);
  });

  it('expands a navigation-chart overlay into one entry per coverage box', () => {
    const charts = chartViewCharts([
      {
        visible: true,
        chartCoverage: {
          coverage: [
            [-83, 27, -82, 28],
            [165, 50, 180, 55],
          ],
          minzoom: 0,
          maxzoom: 18,
        },
      },
    ]);
    expect(charts).toHaveLength(2);
    expect(charts[1]).toEqual({
      visible: true,
      bounds: [165, 50, 180, 55],
      minzoom: 0,
      maxzoom: 18,
    });
  });

  it('treats a coverage-less navigation chart as worldwide, the charts contract', () => {
    expect(chartViewCharts([{ visible: true, chartCoverage: { minzoom: 0 } }])).toEqual([
      { visible: true, bounds: undefined, minzoom: 0, maxzoom: undefined },
    ]);
  });

  it('grades the real NOAA ENC coverage: charted on the Gulf coast, not mid-Atlantic', () => {
    // The load-bearing case: the catalog's regional coverage, not the near-worldwide WMS
    // envelope, is what the badge counts, so a mid-ocean view must never read as charted.
    const catalog = requireCatalogSource('depth-noaa-enc');
    const charts = chartViewCharts([
      {
        visible: true,
        chartCoverage: {
          coverage: catalog.coverage,
          minzoom: catalog.minzoom,
          maxzoom: catalog.maxzoom,
        },
      },
    ]);
    const grade = (longitude: number, latitude: number) =>
      chartViewStatus({
        baseStyleFallback: false,
        chartsLoadState: 'ready',
        charts,
        center: { latitude, longitude },
        zoom: 12,
      });
    expect(grade(-82.7, 27.7)).toBe('active');
    // Mid-Atlantic: inside the service envelope, outside every coverage region.
    expect(grade(-30, 40)).toBe('out-of-coverage');
    // Mediterranean: the envelope spans the globe, the charts do not.
    expect(grade(18, 35)).toBe('out-of-coverage');
  });
});

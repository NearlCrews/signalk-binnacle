import { describe, expect, it } from 'vitest';
import { chartViewStatus } from './chart-view-status';

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
});

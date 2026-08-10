import type { LngLatBbox } from 'signalk-chart-sources';
import { describe, expect, it } from 'vitest';
import type { RouteWaypoint } from '$entities/route';
import { BASEMAP_SOURCE_ID } from '$shared/map';
import type { SavedRegionDto } from './regions-client';
import { checkRouteCoverage } from './route-coverage';

function region(bbox: LngLatBbox, overrides: Partial<SavedRegionDto> = {}): SavedRegionDto {
  return {
    id: overrides.id ?? 'region-1',
    name: 'Area',
    bbox,
    sourceIds: [BASEMAP_SOURCE_ID],
    minzoom: 6,
    maxzoom: 12,
    createdAt: 1,
    lastDownloadedAt: 1,
    bytes: 0,
    status: 'ready',
    cachedBytes: 0,
    unavailableSourceIds: [],
    ...overrides,
  };
}

function wp(latitude: number, longitude: number, name?: string): RouteWaypoint {
  return { position: { latitude, longitude }, ...(name ? { name } : {}) };
}

const equatorRoute = [wp(0, 0), wp(0, 1)];

describe('checkRouteCoverage', () => {
  it('reports complete when one ready area holds the whole corridor at the detail', () => {
    const report = checkRouteCoverage({
      waypoints: equatorRoute,
      regions: [region([-1, -1, 2, 1])],
      corridorNm: 1,
      detail: 'coastal',
    });
    expect(report.verdict).toBe('complete');
    expect(report.gaps).toEqual([]);
    expect(report.sampleCount).toBeGreaterThan(0);
  });

  it('finds a hole between two ready areas and highlights only the gap', () => {
    const report = checkRouteCoverage({
      waypoints: equatorRoute,
      regions: [region([-0.5, -1, 0.4, 1]), region([0.6, -1, 1.5, 1], { id: 'region-2' })],
      corridorNm: 1,
      detail: 'coastal',
    });
    expect(report.verdict).toBe('partial');
    expect(report.uncoveredCount).toBeGreaterThan(0);
    const kinds = report.gaps.map((gap) => gap.properties?.kind);
    expect(kinds).toContain('uncovered');
    for (const gap of report.gaps) {
      const geometry = gap.geometry as GeoJSON.LineString;
      for (const [lon] of geometry.coordinates as [number, number][]) {
        expect(lon).toBeGreaterThan(0.3);
        expect(lon).toBeLessThan(0.7);
      }
    }
  });

  it('treats two overlapping areas as a union, with no false gap at the seam', () => {
    const report = checkRouteCoverage({
      waypoints: equatorRoute,
      regions: [region([-0.5, -1, 0.55, 1]), region([0.45, -1, 1.5, 1], { id: 'region-2' })],
      corridorNm: 1,
      detail: 'coastal',
    });
    expect(report.verdict).toBe('complete');
  });

  it('covers a dogleg corner with both leg bearings', () => {
    const report = checkRouteCoverage({
      waypoints: [wp(0, 0), wp(1, 0), wp(1, 1)],
      regions: [region([-0.3, -0.3, 1.3, 1.3])],
      corridorNm: 1,
      detail: 'coastal',
    });
    expect(report.verdict).toBe('complete');
  });

  it('reads an area whose selected charts no longer exist as no coverage', () => {
    const report = checkRouteCoverage({
      waypoints: equatorRoute,
      regions: [region([-1, -1, 2, 1], { sourceIds: ['not-a-real-source'] })],
      corridorNm: 1,
      detail: 'coastal',
    });
    expect(report.verdict).toBe('partial');
    expect(report.uncoveredCount).toBe(report.sampleCount);
  });

  it('distinguishes inadequate detail from an outright gap', () => {
    const report = checkRouteCoverage({
      waypoints: equatorRoute,
      regions: [region([-1, -1, 2, 1], { minzoom: 5, maxzoom: 9 })],
      corridorNm: 1,
      detail: 'coastal',
    });
    expect(report.verdict).toBe('partial');
    expect(report.detailShortCount).toBe(report.sampleCount);
    expect(report.uncoveredCount).toBe(0);
    expect(report.gaps.every((gap) => gap.properties?.kind === 'insufficient-detail')).toBe(true);
  });

  it('accepts overview detail from the same area when that is all the passage asks for', () => {
    const report = checkRouteCoverage({
      waypoints: equatorRoute,
      regions: [region([-1, -1, 2, 1], { minzoom: 5, maxzoom: 9 })],
      corridorNm: 1,
      detail: 'overview',
    });
    expect(report.verdict).toBe('complete');
  });

  it('widening the corridor exposes edges a narrow strip area does not cover', () => {
    const strip = region([-0.5, -0.05, 1.5, 0.05]);
    const narrow = checkRouteCoverage({
      waypoints: equatorRoute,
      regions: [strip],
      corridorNm: 1,
      detail: 'coastal',
    });
    const wide = checkRouteCoverage({
      waypoints: equatorRoute,
      regions: [strip],
      corridorNm: 5,
      detail: 'coastal',
    });
    expect(narrow.verdict).toBe('complete');
    expect(wide.verdict).toBe('partial');
  });

  it('handles an antimeridian route against a seam-crossing area', () => {
    const covered = checkRouteCoverage({
      waypoints: [wp(0, 179.5), wp(0, -179.5)],
      regions: [region([179, -1, -179, 1])],
      corridorNm: 1,
      detail: 'coastal',
    });
    expect(covered.verdict).toBe('complete');
    const uncovered = checkRouteCoverage({
      waypoints: [wp(0, 179.5), wp(0, -179.5)],
      regions: [],
      corridorNm: 1,
      detail: 'coastal',
    });
    expect(uncovered.verdict).toBe('partial');
    for (const gap of uncovered.gaps) {
      const geometry = gap.geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
      const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
      for (const line of lines) {
        for (const [lon] of line as [number, number][]) {
          expect(Math.abs(lon)).toBeLessThanOrEqual(180);
        }
      }
    }
  });

  it('evaluates each route on its own, so an alternate gets its own verdict', () => {
    const regions = [region([-1, -1, 2, 1])];
    const primary = checkRouteCoverage({
      waypoints: equatorRoute,
      regions,
      corridorNm: 1,
      detail: 'coastal',
    });
    const alternate = checkRouteCoverage({
      waypoints: [wp(5, 5), wp(5, 6)],
      regions,
      corridorNm: 1,
      detail: 'coastal',
    });
    expect(primary.verdict).toBe('complete');
    expect(alternate.verdict).toBe('partial');
  });

  it('ignores areas that are not ready', () => {
    const report = checkRouteCoverage({
      waypoints: equatorRoute,
      regions: [region([-1, -1, 2, 1], { status: 'downloading' })],
      corridorNm: 1,
      detail: 'coastal',
    });
    expect(report.verdict).toBe('partial');
  });

  it('reports unknown rather than guessing when it cannot evaluate', () => {
    expect(
      checkRouteCoverage({
        waypoints: equatorRoute,
        regions: null,
        corridorNm: 1,
        detail: 'coastal',
      }).verdict,
    ).toBe('unknown');
    expect(
      checkRouteCoverage({
        waypoints: [wp(0, 0)],
        regions: [],
        corridorNm: 1,
        detail: 'coastal',
      }).verdict,
    ).toBe('unknown');
    expect(
      checkRouteCoverage({
        waypoints: [wp(0, 0), wp(0, 0)],
        regions: [],
        corridorNm: 1,
        detail: 'coastal',
      }).verdict,
    ).toBe('unknown');
  });
});

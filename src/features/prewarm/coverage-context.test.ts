import { describe, expect, it } from 'vitest';
import {
  routeCoverageAreasKey,
  routeCoverageCatalogKey,
  routeCoverageGeometryKey,
} from './coverage-context';
import type { SavedRegionDto } from './regions-client';

const area: SavedRegionDto = {
  id: 'area',
  name: 'Passage',
  bbox: [-1, -1, 1, 1],
  sourceIds: ['seamark'],
  minzoom: 6,
  maxzoom: 12,
  createdAt: 1,
  lastDownloadedAt: 2,
  bytes: 100,
  cachedBytes: 100,
  status: 'ready',
  unavailableSourceIds: [],
};

describe('Offline coverage identities', () => {
  it('tracks route geometry rather than waypoint labels', () => {
    const waypoints = [{ name: 'First', position: { latitude: 0, longitude: 1 } }];
    const original = routeCoverageGeometryKey(waypoints);
    waypoints[0].name = 'Renamed';
    expect(routeCoverageGeometryKey(waypoints)).toBe(original);
    waypoints[0].position.longitude = 2;
    expect(routeCoverageGeometryKey(waypoints)).not.toBe(original);
  });

  it('distinguishes unknown areas, accepted emptiness, and changed coverage inputs', () => {
    expect(routeCoverageAreasKey(null)).not.toBe(routeCoverageAreasKey([]));
    const original = routeCoverageAreasKey([area]);
    expect(routeCoverageAreasKey([{ ...area, name: 'Renamed' }])).toBe(original);
    expect(routeCoverageAreasKey([{ ...area, status: 'needs-redownload' }])).not.toBe(original);
    expect(routeCoverageAreasKey([{ ...area, unavailableSourceIds: ['seamark'] }])).not.toBe(
      original,
    );
    expect(routeCoverageAreasKey([{ ...area, maxzoom: 10 }])).not.toBe(original);
    expect(routeCoverageAreasKey([{ ...area, bbox: [0, 0, 1, 1] }])).not.toBe(original);
  });

  it('ignores list ordering but includes the actual chart catalog inputs', () => {
    const other = { ...area, id: 'other', sourceIds: ['basemap'] };
    expect(routeCoverageAreasKey([area, other])).toBe(routeCoverageAreasKey([other, area]));
    expect(routeCoverageCatalogKey([area, other])).toBe(routeCoverageCatalogKey([other, area]));
    expect(routeCoverageCatalogKey([area])).not.toBe(routeCoverageCatalogKey([other]));
    expect(routeCoverageCatalogKey([{ ...area, sourceIds: ['missing-chart'] }])).toContain(
      'missing-chart',
    );
  });
});

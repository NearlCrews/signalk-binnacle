import { describe, expect, it } from 'vitest';
import { highlightFeatures, litLegIndices, litWaypointIndices } from './route-highlight';
import type { Route } from './route-types';

// A 4-waypoint route, so there are 3 legs (0, 1, 2) and a clear middle waypoint.
const ROUTE: Route = {
  id: 'r',
  name: 'r',
  waypoints: [
    { position: { latitude: 0, longitude: 0 } },
    { position: { latitude: 0, longitude: 1 } },
    { position: { latitude: 0, longitude: 2 } },
    { position: { latitude: 0, longitude: 3 } },
  ],
};

describe('litWaypointIndices', () => {
  it('lights both end dots of a leg', () => {
    expect(litWaypointIndices({ kind: 'leg', index: 1 }, 4)).toEqual([1, 2]);
  });

  it('lights only the tapped waypoint', () => {
    expect(litWaypointIndices({ kind: 'waypoint', index: 2 }, 4)).toEqual([2]);
  });

  it('drops the end dot when the leg index runs past the route', () => {
    expect(litWaypointIndices({ kind: 'leg', index: 1 }, 2)).toEqual([1]);
  });

  it('lights both dots of the genuine last leg', () => {
    expect(litWaypointIndices({ kind: 'leg', index: 1 }, 3)).toEqual([1, 2]);
  });

  it('returns nothing for no highlight, an out-of-range index, or a negative index', () => {
    expect(litWaypointIndices(undefined, 4)).toEqual([]);
    expect(litWaypointIndices({ kind: 'waypoint', index: 9 }, 4)).toEqual([]);
    expect(litWaypointIndices({ kind: 'waypoint', index: -1 }, 4)).toEqual([]);
  });
});

describe('litLegIndices', () => {
  it('lights the single leg for a leg highlight', () => {
    expect(litLegIndices({ kind: 'leg', index: 2 }, 4)).toEqual([2]);
  });

  it('lights both adjacent legs for a middle waypoint', () => {
    expect(litLegIndices({ kind: 'waypoint', index: 2 }, 4)).toEqual([1, 2]);
  });

  it('lights exactly one leg for an endpoint waypoint', () => {
    expect(litLegIndices({ kind: 'waypoint', index: 0 }, 4)).toEqual([0]);
    expect(litLegIndices({ kind: 'waypoint', index: 3 }, 4)).toEqual([2]);
  });

  it('returns nothing for no highlight, an out-of-range leg, or a route too short for legs', () => {
    expect(litLegIndices(undefined, 4)).toEqual([]);
    expect(litLegIndices({ kind: 'leg', index: 3 }, 4)).toEqual([]);
    expect(litLegIndices({ kind: 'leg', index: -1 }, 4)).toEqual([]);
    expect(litLegIndices({ kind: 'waypoint', index: 0 }, 1)).toEqual([]);
  });
});

describe('highlightFeatures', () => {
  it('builds two dots and one segment for a leg highlight', () => {
    const { dots, segments } = highlightFeatures(ROUTE, { kind: 'leg', index: 1 });
    expect(dots.features.map((f) => f.properties?.index)).toEqual([1, 2]);
    expect(segments.features).toHaveLength(1);
    expect(segments.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [1, 0],
        [2, 0],
      ],
    });
  });

  it('builds one dot and two segments for a middle waypoint', () => {
    const { dots, segments } = highlightFeatures(ROUTE, { kind: 'waypoint', index: 2 });
    expect(dots.features.map((f) => f.properties?.index)).toEqual([2]);
    expect(segments.features.map((f) => f.properties?.index)).toEqual([1, 2]);
  });

  it('builds two dots and one segment for a 2-waypoint route', () => {
    const short: Route = { id: 's', name: 's', waypoints: ROUTE.waypoints.slice(0, 2) };
    const { dots, segments } = highlightFeatures(short, { kind: 'leg', index: 0 });
    expect(dots.features.map((f) => f.properties?.index)).toEqual([0, 1]);
    expect(segments.features.map((f) => f.properties?.index)).toEqual([0]);
  });

  it('is empty with no highlight', () => {
    const { dots, segments } = highlightFeatures(ROUTE, undefined);
    expect(dots.features).toHaveLength(0);
    expect(segments.features).toHaveLength(0);
  });

  it('splits a highlighted leg at the antimeridian', () => {
    const crossing: Route = {
      id: 'crossing',
      name: 'crossing',
      waypoints: [
        { position: { latitude: 10, longitude: 179 } },
        { position: { latitude: 12, longitude: -179 } },
      ],
    };
    const { segments } = highlightFeatures(crossing, { kind: 'leg', index: 0 });
    expect(segments.features[0].geometry.type).toBe('MultiLineString');
  });
});

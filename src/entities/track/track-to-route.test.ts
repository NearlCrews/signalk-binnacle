import { describe, expect, it } from 'vitest';
import { trackToRoute } from './track-to-route';
import type { TrackPoint } from './track-types';

const pt = (lat: number, lon: number): TrackPoint => ({ lat, lon, t: 0, sog: 0 });

describe('trackToRoute', () => {
  it('coarsens a near-straight track to its endpoints', () => {
    // A nearly straight line of dense points collapses to the two ends at a coarse tolerance.
    const points = [pt(0, 0), pt(0, 0.001), pt(0, 0.002), pt(0, 0.003), pt(0, 0.004)];
    const route = trackToRoute(points, 'Straight', 100);
    expect(route.waypoints).toHaveLength(2);
    expect(route.waypoints[0].position).toEqual({ latitude: 0, longitude: 0 });
    expect(route.waypoints[1].position).toEqual({ latitude: 0, longitude: 0.004 });
  });

  it('keeps a sharp corner as a waypoint, in travel order', () => {
    const points = [pt(0, 0), pt(0, 0.01), pt(0.01, 0.01)];
    const route = trackToRoute(points, 'Dogleg', 50);
    expect(route.waypoints.map((w) => [w.position.latitude, w.position.longitude])).toEqual([
      [0, 0],
      [0, 0.01],
      [0.01, 0.01],
    ]);
  });

  it('names the route and gives it an id', () => {
    const route = trackToRoute([pt(1, 1), pt(2, 2)], 'My passage');
    expect(route.name).toBe('My passage');
    expect(route.id).toBeTruthy();
  });

  it('uses only the latest continuous segment after a GPS gap', () => {
    const route = trackToRoute(
      [pt(0, 0), pt(0, 0.01), { ...pt(10, 10), gap: true }, pt(10, 10.01)],
      'After gap',
      10,
    );
    expect(route.waypoints.map((waypoint) => waypoint.position)).toEqual([
      { latitude: 10, longitude: 10 },
      { latitude: 10, longitude: 10.01 },
    ]);
  });

  it('does not invent a route when the latest segment has one point', () => {
    const route = trackToRoute([pt(0, 0), pt(0, 0.01), { ...pt(10, 10), gap: true }], 'Gap');
    expect(route.waypoints).toHaveLength(1);
  });
});

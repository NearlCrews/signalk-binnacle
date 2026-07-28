import { describe, expect, it } from 'vitest';
import { waypointHref } from './waypoint-href';

describe('waypointHref', () => {
  it('builds the server-relative resource href for a waypoint id', () => {
    expect(waypointHref('b7a1f0e2-3c4d-4a5b-8c6d-7e8f9a0b1c2d')).toBe(
      '/resources/waypoints/b7a1f0e2-3c4d-4a5b-8c6d-7e8f9a0b1c2d',
    );
  });

  it('encodes an id carrying characters that would break the path segment', () => {
    expect(waypointHref('a b/c#d?e')).toBe('/resources/waypoints/a%20b%2Fc%23d%3Fe');
  });
});

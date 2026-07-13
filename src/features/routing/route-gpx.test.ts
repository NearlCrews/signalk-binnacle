import { describe, expect, it } from 'vitest';
import type { Route } from '$entities/route';
import { routeGpxFilename, routeToGpx } from './route-gpx';

const route: Route = {
  id: 'r1',
  name: 'Bay & "run"',
  waypoints: [
    { position: { latitude: 42.5, longitude: -83.1 }, name: 'Start' },
    { position: { latitude: 42.6, longitude: -83.2 } },
  ],
};

describe('routeToGpx', () => {
  it('emits a GPX rte with rtept lat/lon and names, escaping XML', () => {
    const gpx = routeToGpx(route);
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain('<rtept lat="42.5" lon="-83.1"><name>Start</name></rtept>');
    expect(gpx).toContain('<rtept lat="42.6" lon="-83.2"></rtept>');
    // The route name's special characters are escaped.
    expect(gpx).toContain('<name>Bay &amp; &quot;run&quot;</name>');
  });

  it('emits one rtept per waypoint with no unescaped ampersands', () => {
    const gpx = routeToGpx(route);
    expect(gpx.match(/<rtept\b/g)).toHaveLength(2);
    // Every & must open a known XML entity, so a raw & in a name would leave malformed output.
    expect(gpx.match(/&(?!(amp|lt|gt|apos|quot);)/g)).toBeNull();
  });

  it('removes invalid XML characters from names', () => {
    const gpx = routeToGpx({ ...route, name: 'Bay\u0000 route' });
    expect(gpx).toContain('<name>Bay route</name>');
    expect(gpx).not.toContain('\u0000');
  });

  it('creates a portable bounded filename', () => {
    expect(routeGpxFilename({ ...route, name: ' Port/Starboard?.. ' })).toBe('Port-Starboard-.gpx');
    expect(routeGpxFilename({ ...route, name: 'x'.repeat(200) })).toHaveLength(124);
  });
});

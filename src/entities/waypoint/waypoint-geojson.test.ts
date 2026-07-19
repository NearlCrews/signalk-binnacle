import { describe, expect, it } from 'vitest';
import { featureToWaypoint, waypointToFeature } from './waypoint-geojson';
import type { Waypoint } from './waypoint-types';

const WAYPOINT: Waypoint = {
  id: 'b7a1f0e2-3c4d-4a5b-8c6d-7e8f9a0b1c2d',
  name: 'Harbor entrance',
  position: { latitude: 44.1, longitude: -86.5 },
  description: 'Leave the red nun to starboard.',
};

describe('waypointToFeature', () => {
  it('emits name and description at the top level and a [lon, lat] Point feature', () => {
    const body = waypointToFeature(WAYPOINT);
    expect(body.name).toBe('Harbor entrance');
    expect(body.description).toBe('Leave the red nun to starboard.');
    expect(body.feature.type).toBe('Feature');
    expect(body.feature.geometry).toEqual({ type: 'Point', coordinates: [-86.5, 44.1] });
  });

  it('omits description when the waypoint has none', () => {
    const body = waypointToFeature({ ...WAYPOINT, description: undefined });
    expect('description' in body).toBe(false);
  });

  it('writes the icon into feature.properties.skIcon, defaults to "waypoint" when none', () => {
    expect(waypointToFeature({ ...WAYPOINT, icon: 'custom:dive-flag' }).feature.properties).toEqual(
      {
        skIcon: 'custom:dive-flag',
      },
    );
    expect(waypointToFeature(WAYPOINT).feature.properties).toEqual({ skIcon: 'waypoint' });
  });
});

describe('featureToWaypoint', () => {
  it('round-trips a waypoint through the resource body', () => {
    const back = featureToWaypoint(WAYPOINT.id, waypointToFeature(WAYPOINT));
    expect(back).toEqual({ ...WAYPOINT, icon: 'waypoint' });
  });

  it('round-trips the icon via feature.properties.skIcon', () => {
    const withIcon = { ...WAYPOINT, icon: 'custom:dive-flag' };
    expect(featureToWaypoint(withIcon.id, waypointToFeature(withIcon))).toEqual(withIcon);
  });

  it('falls back to the id as the name and drops an empty description', () => {
    const back = featureToWaypoint('wp-id', {
      description: '',
      feature: { geometry: { type: 'Point', coordinates: [1, 2] } },
    });
    expect(back).toEqual({ id: 'wp-id', name: 'wp-id', position: { latitude: 2, longitude: 1 } });
  });

  it('returns undefined for malformed entries', () => {
    expect(featureToWaypoint('id', undefined)).toBeUndefined();
    expect(featureToWaypoint('id', 'junk')).toBeUndefined();
    expect(featureToWaypoint('id', {})).toBeUndefined();
    expect(
      featureToWaypoint('id', {
        feature: {
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
      }),
    ).toBeUndefined();
    expect(
      featureToWaypoint('id', { feature: { geometry: { type: 'Point', coordinates: ['x', 2] } } }),
    ).toBeUndefined();
  });

  it('rejects unsafe ids and bounds provider-controlled text', () => {
    expect(featureToWaypoint('', waypointToFeature(WAYPOINT))).toBeUndefined();
    expect(featureToWaypoint('bad\u0000id', waypointToFeature(WAYPOINT))).toBeUndefined();
    expect(featureToWaypoint('  safe-id  ', waypointToFeature(WAYPOINT))).toBeUndefined();
    expect(featureToWaypoint('w'.repeat(513), waypointToFeature(WAYPOINT))).toBeUndefined();

    const waypoint = featureToWaypoint('safe-id', {
      name: `  ${'n'.repeat(300)}  `,
      description: 'd'.repeat(10_100),
      feature: {
        geometry: { type: 'Point', coordinates: [1, 2] },
        properties: { skIcon: 'i'.repeat(300) },
      },
    });
    expect(waypoint?.id).toBe('safe-id');
    expect(waypoint?.name).toHaveLength(256);
    expect(waypoint?.description).toHaveLength(10_000);
    expect(waypoint?.icon).toHaveLength(256);
  });
});

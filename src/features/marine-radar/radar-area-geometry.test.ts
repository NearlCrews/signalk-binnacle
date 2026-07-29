import { describe, expect, it } from 'vitest';
import { geodesicDestination } from '$shared/nav';
import { MarineRadarStore } from './marine-radar-store.svelte';
import {
  radarAreaChartInstruction,
  radarAreaFeatures,
  updateRadarAreaFromChart,
} from './radar-area-geometry';
import type { ControlDefinition, RadarAreaDraft } from './radar-types';

const center = { latitude: 42, longitude: -83 };
const zone: ControlDefinition = {
  id: 'guardZone1',
  name: 'Guard zone 1',
  dialect: 'native',
  type: 'zone',
  range: { min: -Math.PI, max: Math.PI, unit: 'rad' },
  hasEnabled: true,
  maxDistance: 10_000,
};
const sector: ControlDefinition = {
  ...zone,
  id: 'noTransmitSector1',
  name: 'No-transmit sector 1',
  type: 'sector',
  maxDistance: undefined,
};
const rect: ControlDefinition = {
  ...zone,
  id: 'exclusionRect1',
  name: 'Exclusion rectangle 1',
  type: 'rect',
  range: { min: 0, max: 10_000, unit: 'm' },
};

describe('radar area geometry', () => {
  it('renders complete native zones, sectors, and rectangles with active draft state', () => {
    const store = new MarineRadarStore();
    store.setDiscovered([
      {
        id: 'stationary',
        name: 'Stationary',
        status: 'standby',
        spokesPerRevolution: 16,
        maxSpokeLen: 8,
        range: 4_000,
        controls: {
          guardZone1: {
            value: -0.5,
            endValue: 0.5,
            startDistance: 100,
            endDistance: 500,
            enabled: true,
          },
          noTransmitSector1: { value: -1, endValue: -0.5, enabled: false },
          exclusionRect1: { x1: -100, y1: 50, x2: 100, y2: 50, width: 25, enabled: true },
        },
      },
    ]);
    store.setCapabilities([zone, sector, rect]);
    store.setAreaDraft({
      radarId: 'stationary',
      controlId: 'guardZone1',
      type: 'zone',
      value: {
        value: -0.25,
        endValue: 0.5,
        startDistance: 100,
        endDistance: 700,
        enabled: true,
      },
      chartEditing: false,
      chartStep: 0,
    });

    const features = radarAreaFeatures(store, center, 0, 4_000).features;
    expect(features).toHaveLength(3);
    expect(features.map((feature) => feature.properties?.kind)).toEqual(['zone', 'sector', 'rect']);
    expect(features[0]?.properties?.active).toBe(true);
    expect(features[1]?.properties?.enabled).toBe(false);
    expect(features.every((feature) => feature.geometry.coordinates[0]?.length > 3)).toBe(true);
  });

  it('uses two chart taps for a sector and zone, then returns to form review', () => {
    const startPoint = geodesicDestination(center.latitude, center.longitude, 0, 500);
    const endPoint = geodesicDestination(center.latitude, center.longitude, Math.PI / 2, 1_000);
    let draft: RadarAreaDraft = {
      radarId: 'a',
      controlId: sector.id,
      type: 'sector',
      value: { value: 0, endValue: 0, enabled: true },
      chartEditing: true,
      chartStep: 0,
    };
    draft = updateRadarAreaFromChart(draft, sector, center, 0, {
      latitude: startPoint[1],
      longitude: startPoint[0],
    });
    expect(draft.chartStep).toBe(1);
    draft = updateRadarAreaFromChart(draft, sector, center, 0, {
      latitude: endPoint[1],
      longitude: endPoint[0],
    });
    expect(draft.chartEditing).toBe(false);
    expect('endValue' in draft.value ? draft.value.endValue : 0).toBeCloseTo(Math.PI / 2, 3);

    let zoneDraft: RadarAreaDraft = {
      radarId: 'a',
      controlId: zone.id,
      type: 'zone',
      value: { value: 0, endValue: 0, startDistance: 0, endDistance: 0, enabled: true },
      chartEditing: true,
      chartStep: 0,
    };
    zoneDraft = updateRadarAreaFromChart(zoneDraft, zone, center, 0, {
      latitude: endPoint[1],
      longitude: endPoint[0],
    });
    expect(radarAreaChartInstruction(zoneDraft)).toContain('outer end');
    zoneDraft = updateRadarAreaFromChart(zoneDraft, zone, center, 0, {
      latitude: startPoint[1],
      longitude: startPoint[0],
    });
    expect(zoneDraft.chartEditing).toBe(false);
    expect('startDistance' in zoneDraft.value ? zoneDraft.value.startDistance : 0).toBeCloseTo(
      500,
      0,
    );
    if (!('startDistance' in zoneDraft.value)) throw new Error('expected a zone draft');
    expect(zoneDraft.value.value).toBeCloseTo(0, 3);
    expect(zoneDraft.value.endValue).toBeCloseTo(Math.PI / 2, 3);
  });

  it('uses three chart taps to define a rectangle edge and positive width', () => {
    const east = (bearing: number, distance: number) => {
      const point = geodesicDestination(center.latitude, center.longitude, bearing, distance);
      return { latitude: point[1], longitude: point[0] };
    };
    let draft: RadarAreaDraft = {
      radarId: 'a',
      controlId: rect.id,
      type: 'rect',
      value: { x1: 0, y1: 0, x2: 0, y2: 0, width: 0, enabled: false },
      chartEditing: true,
      chartStep: 0,
    };
    draft = updateRadarAreaFromChart(draft, rect, center, undefined, east(0, 100));
    draft = updateRadarAreaFromChart(draft, rect, center, undefined, east(Math.PI / 2, 100));
    expect(draft.chartStep).toBe(2);
    expect('width' in draft.value ? draft.value.width : 0).toBeGreaterThan(0);
    draft = updateRadarAreaFromChart(draft, rect, center, undefined, east(Math.PI, 100));
    expect(draft.chartEditing).toBe(false);
    expect('width' in draft.value ? draft.value.width : 0).toBeGreaterThan(0);
  });

  it('caps a full-circle area at the fixed tessellation budget', () => {
    const store = new MarineRadarStore();
    store.setDiscovered([
      {
        id: 'stationary',
        name: 'Stationary',
        status: 'standby',
        spokesPerRevolution: 16,
        maxSpokeLen: 8,
        range: 4_000,
        controls: {
          guardZone1: {
            value: -Math.PI,
            endValue: -Math.PI,
            startDistance: 100,
            endDistance: 500,
            enabled: true,
          },
        },
      },
    ]);
    store.setCapabilities([zone]);

    const [feature] = radarAreaFeatures(store, center, 0, 4_000).features;
    expect(feature?.geometry.coordinates[0]?.length).toBeLessThanOrEqual(100);
  });
});

import { describe, expect, it } from 'vitest';
import type { ControlDefinition } from './radar-types';
import {
  isNativeZoneDefinition,
  radarZoneValue,
  validateRadarZone,
  zoneDraftFromValue,
  zoneValueFromDraft,
} from './radar-zone-model';

const definition: ControlDefinition = {
  id: 'guardZone1',
  name: 'Guard zone 1',
  dialect: 'native',
  type: 'zone',
  range: { min: -Math.PI, max: Math.PI, step: Math.PI / 180, unit: 'rad' },
  hasEnabled: true,
  maxDistance: 100_000,
};

describe('radar zone model', () => {
  it('accepts only a complete bounded native zone definition', () => {
    expect(isNativeZoneDefinition(definition)).toBe(true);
    expect(isNativeZoneDefinition({ ...definition, dialect: 'v5' })).toBe(false);
    expect(isNativeZoneDefinition({ ...definition, maxDistance: undefined })).toBe(false);
    expect(isNativeZoneDefinition({ ...definition, hasEnabled: false })).toBe(false);
    expect(
      isNativeZoneDefinition({
        ...definition,
        range: { min: -1_000_000, max: 1_000_000, unit: 'rad' },
      }),
    ).toBe(false);
  });

  it('requires complete geometry and treats an omitted native enabled state as disabled', () => {
    expect(
      radarZoneValue({
        value: -1,
        endValue: 1,
        startDistance: 200,
        endDistance: 500,
        enabled: false,
      }),
    ).toEqual({
      value: -1,
      endValue: 1,
      startDistance: 200,
      endDistance: 500,
      enabled: false,
    });
    expect(
      radarZoneValue({
        value: -1,
        endValue: 1,
        startDistance: 200,
        endDistance: 500,
      }),
    ).toEqual({
      value: -1,
      endValue: 1,
      startDistance: 200,
      endDistance: 500,
      enabled: false,
    });
    expect(radarZoneValue({ value: -1, endValue: 1 })).toBeUndefined();
  });

  it('round-trips radians and metric or imperial display distances at the edge', () => {
    const value = {
      value: -Math.PI / 2,
      endValue: Math.PI / 4,
      startDistance: 304.8,
      endDistance: 609.6,
      enabled: false,
    };
    expect(zoneValueFromDraft(zoneDraftFromValue(value, 'metric'), 'metric')).toEqual(value);
    const imperial = zoneDraftFromValue(value, 'imperial');
    expect(imperial.innerDistance).toBeCloseTo(1000);
    expect(imperial.outerDistance).toBeCloseTo(2000);
    expect(zoneValueFromDraft(imperial, 'imperial')).toEqual(value);
  });

  it('validates angles, distances, ordering, and finite values without sorting endpoints', () => {
    expect(
      validateRadarZone(definition, {
        value: Math.PI,
        endValue: -Math.PI,
        startDistance: 0,
        endDistance: 100_000,
        enabled: true,
      }),
    ).toBeUndefined();
    expect(
      validateRadarZone(definition, {
        value: Math.PI + 0.01,
        endValue: 0,
        startDistance: 0,
        endDistance: 10,
        enabled: true,
      }),
    ).toContain('angles');
    expect(
      validateRadarZone(definition, {
        value: 0,
        endValue: 1,
        startDistance: 20,
        endDistance: 10,
        enabled: true,
      }),
    ).toContain('Inner distance');
    expect(
      validateRadarZone(definition, {
        value: Number.NaN,
        endValue: 1,
        startDistance: 0,
        endDistance: 10,
        enabled: true,
      }),
    ).toContain('finite');
  });
});

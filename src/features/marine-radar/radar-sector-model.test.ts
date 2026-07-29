import { describe, expect, it } from 'vitest';
import {
  isNativeSectorDefinition,
  radarSectorValue,
  sectorDraftFromValue,
  sectorValueFromDraft,
  validateRadarSector,
} from './radar-sector-model';
import type { ControlDefinition } from './radar-types';

const definition: ControlDefinition = {
  id: 'noTransmitSector1',
  name: 'No-transmit sector 1',
  dialect: 'native',
  type: 'sector',
  range: { min: -Math.PI, max: Math.PI, step: Math.PI / 180, unit: 'rad' },
  hasEnabled: true,
};

describe('radar sector model', () => {
  it('accepts only a bounded native radian sector with enabled state', () => {
    expect(isNativeSectorDefinition(definition)).toBe(true);
    expect(isNativeSectorDefinition({ ...definition, dialect: 'v5' })).toBe(false);
    expect(isNativeSectorDefinition({ ...definition, hasEnabled: false })).toBe(false);
    expect(
      isNativeSectorDefinition({ ...definition, range: { min: -1, max: 1, unit: 'deg' } }),
    ).toBe(false);
    expect(
      isNativeSectorDefinition({
        ...definition,
        range: { min: -1_000_000, max: 1_000_000, unit: 'rad' },
      }),
    ).toBe(false);
    expect(
      isNativeSectorDefinition({
        ...definition,
        range: { min: -Math.PI * 2, max: Math.PI * 2, unit: 'rad' },
      }),
    ).toBe(false);
  });

  it('requires both angles and treats an omitted native enabled state as disabled', () => {
    expect(radarSectorValue({ value: -1, endValue: 1, enabled: false })).toEqual({
      value: -1,
      endValue: 1,
      enabled: false,
    });
    expect(radarSectorValue({ value: -1, endValue: 1 })).toEqual({
      value: -1,
      endValue: 1,
      enabled: false,
    });
    expect(radarSectorValue({ value: -1 })).toBeUndefined();
  });

  it('round-trips radians at the display edge and validates both endpoints', () => {
    const value = { value: -Math.PI / 2, endValue: Math.PI / 4, enabled: true };
    expect(sectorValueFromDraft(sectorDraftFromValue(value))).toEqual(value);
    expect(validateRadarSector(definition, value)).toBeUndefined();
    expect(validateRadarSector(definition, { ...value, endValue: Math.PI + 0.01 })).toContain(
      'angles',
    );
    expect(validateRadarSector(definition, { ...value, value: Number.NaN })).toContain('finite');
  });
});

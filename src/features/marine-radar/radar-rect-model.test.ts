import { describe, expect, it } from 'vitest';
import {
  isNativeRectDefinition,
  radarRectValue,
  rectDraftFromValue,
  rectValueFromDraft,
  validateRadarRect,
} from './radar-rect-model';
import type { ControlDefinition } from './radar-types';

const definition: ControlDefinition = {
  id: 'exclusionRect1',
  name: 'Exclusion rectangle 1',
  dialect: 'native',
  type: 'rect',
  range: { min: 0, max: 100_000, unit: 'm' },
  hasEnabled: true,
  maxDistance: 100_000,
};

describe('radar rectangle model', () => {
  it('accepts only a bounded native meter rectangle with enabled state', () => {
    expect(isNativeRectDefinition(definition)).toBe(true);
    expect(isNativeRectDefinition({ ...definition, dialect: 'v5' })).toBe(false);
    expect(isNativeRectDefinition({ ...definition, maxDistance: undefined })).toBe(false);
    expect(isNativeRectDefinition({ ...definition, range: { min: 0, max: 1, unit: 'ft' } })).toBe(
      false,
    );
  });

  it('requires complete geometry and treats an omitted native enabled state as disabled', () => {
    expect(
      radarRectValue({ x1: -100, y1: 50, x2: 100, y2: 50, width: 20, enabled: false }),
    ).toEqual({ x1: -100, y1: 50, x2: 100, y2: 50, width: 20, enabled: false });
    expect(radarRectValue({ x1: -100, y1: 50, x2: 100, y2: 50, width: 20 })).toEqual({
      x1: -100,
      y1: 50,
      x2: 100,
      y2: 50,
      width: 20,
      enabled: false,
    });
    expect(radarRectValue({ x1: -100, y1: 50, x2: 100, y2: 50 })).toBeUndefined();
  });

  it('round-trips metric and imperial display values at the edge', () => {
    const value = { x1: -304.8, y1: 0, x2: 304.8, y2: 0, width: 30.48, enabled: true };
    expect(rectValueFromDraft(rectDraftFromValue(value, 'metric'), 'metric')).toEqual(value);
    const imperial = rectDraftFromValue(value, 'imperial');
    expect(imperial.x1).toBeCloseTo(-1000);
    expect(imperial.width).toBeCloseTo(100);
    expect(rectValueFromDraft(imperial, 'imperial')).toEqual(value);
  });

  it('rejects out-of-bounds corners, zero width, and a collapsed edge', () => {
    const value = { x1: -100, y1: 50, x2: 100, y2: 50, width: 20, enabled: true };
    expect(validateRadarRect(definition, value)).toBeUndefined();
    expect(validateRadarRect(definition, { ...value, x1: -100_001 })).toContain('corner');
    expect(validateRadarRect(definition, { ...value, width: 0 })).toContain('Width');
    expect(validateRadarRect(definition, { ...value, x2: -100, y2: 50 })).toContain('different');
  });
});

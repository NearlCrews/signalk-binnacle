import { describe, expect, it } from 'vitest';
import { THEMES } from '$shared/ui';
import { mapThemePaint } from './map-theme';

describe('scrubMarker theme token', () => {
  it('is a non-empty color for every theme', () => {
    for (const theme of THEMES) {
      const paint = mapThemePaint(theme);
      expect(typeof paint.scrubMarker).toBe('string');
      expect(paint.scrubMarker.length).toBeGreaterThan(0);
    }
  });
});

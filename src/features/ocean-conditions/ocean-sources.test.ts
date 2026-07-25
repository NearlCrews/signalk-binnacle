import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOceanSources } from './ocean-sources';

describe('buildOceanSources', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T12:00:00Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('labels daily imagery with its date and rollover recovery', () => {
    for (const source of buildOceanSources()) {
      expect(source.description).toContain('2026-06-07');
      expect(source.description).toContain('Reload after the UTC date changes');
    }
  });
});

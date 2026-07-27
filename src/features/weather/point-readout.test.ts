import { describe, expect, it } from 'vitest';
import { isCurrentReadoutRequest, mergePointReadouts } from './point-readout.svelte';

describe('point readout provider merge', () => {
  it('accepts a pressure-only provider contribution over grid wind', () => {
    const merged = mergePointReadouts(
      { pressurePa: 101_300 },
      { speedMs: 8, fromRad: 1, pressurePa: 100_000 },
      'Marine Provider',
    );
    expect(merged).toEqual({
      value: { speedMs: 8, fromRad: 1, pressurePa: 101_300 },
      source: 'Marine Provider + Open-Meteo',
    });
  });

  it('requires complete wind only after provider and grid fields are merged', () => {
    expect(mergePointReadouts({ pressurePa: 101_300 }, undefined, 'Provider')).toBeUndefined();
  });

  it('lets the grid keep a field the provider left undefined', () => {
    const merged = mergePointReadouts(
      { pressurePa: undefined, gustMs: 12 },
      { speedMs: 8, fromRad: 1, pressurePa: 100_000 },
      'Marine Provider',
    );
    expect(merged).toEqual({
      value: { speedMs: 8, fromRad: 1, pressurePa: 100_000, gustMs: 12 },
      source: 'Marine Provider + Open-Meteo',
    });
  });

  it('credits the provider alone when it covers every grid field', () => {
    const merged = mergePointReadouts(
      { speedMs: 9, fromRad: 2 },
      { speedMs: 8, fromRad: 1 },
      'Marine Provider',
    );
    expect(merged).toEqual({ value: { speedMs: 9, fromRad: 2 }, source: 'Marine Provider' });
  });

  it('reports the grid as the source when the provider contributes nothing', () => {
    const merged = mergePointReadouts({}, { speedMs: 8, fromRad: 1 }, 'Marine Provider');
    expect(merged).toEqual({ value: { speedMs: 8, fromRad: 1 }, source: 'Open-Meteo' });
  });

  it('completes wind from the provider when the grid has none', () => {
    const merged = mergePointReadouts({ speedMs: 6, fromRad: 3 }, undefined, 'Marine Provider');
    expect(merged).toEqual({ value: { speedMs: 6, fromRad: 3 }, source: 'Marine Provider' });
  });
});

describe('point readout request guard', () => {
  it('rejects old answers after either the request or scrubbed time changes', () => {
    expect(isCurrentReadoutRequest(2, 2, 1000, 2000)).toBe(false);
    expect(isCurrentReadoutRequest(1, 2, 2000, 2000)).toBe(false);
    expect(isCurrentReadoutRequest(2, 2, 2000, 2000)).toBe(true);
  });
});

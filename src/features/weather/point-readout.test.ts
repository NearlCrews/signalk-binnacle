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
});

describe('point readout request guard', () => {
  it('rejects old answers after either the request or scrubbed time changes', () => {
    expect(isCurrentReadoutRequest(2, 2, 1000, 2000)).toBe(false);
    expect(isCurrentReadoutRequest(1, 2, 2000, 2000)).toBe(false);
    expect(isCurrentReadoutRequest(2, 2, 2000, 2000)).toBe(true);
  });
});

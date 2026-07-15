import { describe, expect, it, vi } from 'vitest';
import { createFakeMap } from '$shared/testing';
import { beforeIdFor, installSentinels, sentinelId } from './sentinels';
import { Z_ORDER } from './types';

describe('sentinels', () => {
  it('installs one sentinel per z-band', () => {
    const map = createFakeMap();
    installSentinels(map as never);
    for (const band of Z_ORDER) {
      expect(map.getLayer(sentinelId(band))).toBeDefined();
    }
  });

  it('is idempotent', () => {
    const map = createFakeMap();
    const spy = vi.spyOn(map, 'addLayer');
    installSentinels(map as never);
    installSentinels(map as never);
    expect(spy).toHaveBeenCalledTimes(Z_ORDER.length);
  });

  it('beforeIdFor returns the next band sentinel', () => {
    // Derive each band's expected anchor from Z_ORDER (the band above it), so the test does not pin
    // a specific pair and survives a band reorder.
    for (let i = 0; i < Z_ORDER.length - 1; i++) {
      expect(beforeIdFor(Z_ORDER[i])).toBe(sentinelId(Z_ORDER[i + 1]));
    }
  });

  it('beforeIdFor returns undefined for the top band', () => {
    expect(beforeIdFor('overlay-top')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { AisTargets } from '$entities/ais';
import { CollisionAssessment } from '$entities/collision';
import { OwnVessel } from '$entities/vessel';
import { mapThemePaint } from '$shared/map';
import { createThresholds } from '$shared/settings';
import { SignalKStore } from '$shared/signalk';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { createCollisionOverlay } from './collision-overlay';

function dangerCollision(): CollisionAssessment {
  const store = new SignalKStore();
  store.applyFrame({
    self: new Map<string, unknown>([['navigation.position', { latitude: 0, longitude: 0 }]]),
    ais: new Map([
      [
        'vessels.a',
        new Map<string, unknown>([
          ['navigation.position', { latitude: 0.01, longitude: 0 }],
          ['navigation.closestApproach', { distance: 100, timeTo: 60 }],
        ]),
      ],
    ]),
    connection: { phase: 'open', attempt: 0 },
    epoch: Date.now(),
  });
  return new CollisionAssessment(new OwnVessel(store), new AisTargets(store), createThresholds());
}

describe('collision overlay', () => {
  it('adds a source and a ring layer in the safety band with the danger contact', () => {
    const overlay = createCollisionOverlay(dangerCollision());
    const map = createFakeMap();
    overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('safety');
    // Pinned safety ring: an active alarm must never be user-dimmable.
    expect(overlay.supportsOpacity).toBe(false);
    expect(overlay.setOpacity).toBeUndefined();
    expect(map.sources.size).toBe(1);
    expect(map.layers.size).toBe(1);
    const source = [...map.sources.values()][0];
    expect((source.data as { features: unknown[] }).features).toHaveLength(1);
  });

  it('applyTheme recolors the ring stroke', () => {
    const overlay = createCollisionOverlay(dangerCollision());
    const map = createFakeMap();
    overlay.add(fakeOverlayContext(map));
    overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red'));
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-collision-ring',
      'circle-stroke-color',
      expect.anything(),
    );
  });
});

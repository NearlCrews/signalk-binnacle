import { describe, expect, it } from 'vitest';
import { MobStore } from '$entities/mob';
import { OwnVessel } from '$entities/vessel';
import type { OverlayContext } from '$shared/map';
import { SignalKStore } from '$shared/signalk';
import { createFakeMap } from '$shared/testing/fake-map';
import { createFakeStorage } from '$shared/testing/fake-storage';
import { createFrameFactory } from '$shared/testing/sk-frame';
import { createMobOverlay } from './mob-overlay';

const frame = createFrameFactory();

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

function setup() {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  const mob = new MobStore(store, vessel, undefined, createFakeStorage());
  const map = createFakeMap();
  const overlay = createMobOverlay(mob, vessel);
  return { store, mob, map, overlay, ctx: ctxFor(map) };
}

function features(map: ReturnType<typeof createFakeMap>): GeoJSON.Feature[] {
  const data = map.sources.get('binnacle-mob')?.data as GeoJSON.FeatureCollection | undefined;
  return data?.features ?? [];
}

describe('mob overlay', () => {
  it('renders nothing without a mark', () => {
    const { overlay, map, ctx } = setup();
    overlay.add(ctx);
    overlay.sync(ctx);
    expect(features(map)).toHaveLength(0);
  });

  it('renders the mark and the line back from the boat', () => {
    const { store, mob, overlay, map, ctx } = setup();
    overlay.add(ctx);
    store.applyFrame(frame({ 'navigation.position': { latitude: 1, longitude: 2 } }));
    mob.trigger();
    overlay.sync(ctx);
    expect(
      features(map)
        .map((f) => f.geometry.type)
        .sort(),
    ).toEqual(['LineString', 'Point']);
  });

  it('clears once the mark is cancelled', () => {
    const { store, mob, overlay, map, ctx } = setup();
    overlay.add(ctx);
    store.applyFrame(frame({ 'navigation.position': { latitude: 1, longitude: 2 } }));
    mob.trigger();
    overlay.sync(ctx);
    mob.cancel();
    overlay.sync(ctx);
    expect(features(map)).toHaveLength(0);
  });
});

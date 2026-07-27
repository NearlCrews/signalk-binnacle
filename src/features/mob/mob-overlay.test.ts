import { describe, expect, it } from 'vitest';
import { MobStore } from '$entities/mob';
import { OwnVessel } from '$entities/vessel';
import { SignalKStore } from '$shared/signalk';
import {
  createFakeMap,
  createFakeStorage,
  createFrameFactory,
  fakeOverlayContext,
  sourceFeatures,
} from '$shared/testing';
import { createMobOverlay } from './mob-overlay';

const frame = createFrameFactory();

function setup() {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  const mob = new MobStore(store, vessel, undefined, createFakeStorage());
  const map = createFakeMap();
  const overlay = createMobOverlay(mob, vessel);
  return { store, mob, map, overlay, ctx: fakeOverlayContext(map) };
}

describe('mob overlay', () => {
  it('renders nothing without a mark', async () => {
    const { overlay, map, ctx } = setup();
    await overlay.add(ctx);
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-mob')).toHaveLength(0);
  });

  it('renders the mark and the line back from the boat', async () => {
    const { store, mob, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    store.applyFrame(frame({ 'navigation.position': { latitude: 1, longitude: 2 } }));
    mob.trigger();
    overlay.sync(ctx);
    expect(
      sourceFeatures(map, 'binnacle-mob')
        .map((f) => f.geometry.type)
        .sort(),
    ).toEqual(['LineString', 'Point']);
  });

  it('splits the return line when the boat crosses the antimeridian', async () => {
    const { store, mob, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    store.applyFrame(frame({ 'navigation.position': { latitude: 10, longitude: 179 } }));
    mob.trigger();
    store.applyFrame(frame({ 'navigation.position': { latitude: 12, longitude: -179 } }));
    overlay.sync(ctx);

    const line = sourceFeatures(map, 'binnacle-mob').find(
      (feature) => feature.properties?.line === true,
    );
    expect(line?.geometry.type).toBe('MultiLineString');
  });

  it('clears once the mark is cancelled', async () => {
    const { store, mob, overlay, map, ctx } = setup();
    await overlay.add(ctx);
    store.applyFrame(frame({ 'navigation.position': { latitude: 1, longitude: 2 } }));
    mob.trigger();
    overlay.sync(ctx);
    mob.cancel();
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-mob')).toHaveLength(0);
  });
});

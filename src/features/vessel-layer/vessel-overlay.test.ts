import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnVessel } from '$entities/vessel';
import { mapThemePaint } from '$shared/map';
import { deadReckonedPosition } from '$shared/nav';
import { SignalKStore } from '$shared/signalk';
import { createFakeMap, fakeOverlayContext, sourceFeatures } from '$shared/testing';
import { createVesselOverlay, type VesselMotion } from './vessel-overlay';

// ImageData is a browser global; the overlay builds the vessel icon with it, so the
// node test environment needs a minimal stand-in.
class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

beforeEach(() => {
  vi.stubGlobal('ImageData', FakeImageData);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('vessel overlay', () => {
  it('adds the images, the sources, the symbol layers, and the predictor line', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(map.images.size).toBe(2);
    expect(map.sources.size).toBe(2);
    expect(map.layers.size).toBe(3);
    expect(map.layers.get('binnacle-own-vessel-stale')).toMatchObject({
      filter: ['==', ['get', 'stale'], true],
      layout: { 'icon-rotation-alignment': 'viewport' },
    });
    expect(map.layers.get('binnacle-own-vessel-vector-line')).toMatchObject({ type: 'line' });
  });

  it('shows the unrotated question badge when the retained fix becomes stale', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    store.applyFrame({
      self: new Map([['navigation.position', { latitude: 36.8, longitude: -121.7 }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1,
    });
    await overlay.add(ctx);
    expect(
      sourceFeatures<{ properties: { stale: boolean } }>(map, 'binnacle-own-vessel')[0],
    ).toMatchObject({ properties: { stale: false } });

    store.applyFrame({
      self: new Map(),
      selfStales: new Map([['navigation.position', {}]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2,
    });
    overlay.sync(ctx);
    expect(
      sourceFeatures<{ properties: { stale: boolean } }>(map, 'binnacle-own-vessel')[0],
    ).toMatchObject({ properties: { stale: true } });
  });

  it('updates the source position from the store', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    store.applyFrame({
      self: new Map<string, unknown>([
        ['navigation.position', { latitude: 36.8, longitude: -121.7 }],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1,
    });
    overlay.sync(fakeOverlayContext(map));
    const source = [...map.sources.values()][0];
    const fc = source.data as { features: Array<{ geometry: { coordinates: number[] } }> };
    expect(fc.features[0].geometry.coordinates).toEqual([-121.7, 36.8]);
  });

  it('applyTheme recolors the icon image', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.applyTheme?.(fakeOverlayContext(map), mapThemePaint('night-red'));
    expect(map.updatedImages).toContain('binnacle-vessel');
    expect(map.updatedImages).toContain('binnacle-vessel-stale-badge');
  });

  it('dims review rendering without changing the accepted layer opacity', async () => {
    const store = new SignalKStore();
    let reviewing = false;
    const overlay = createVesselOverlay(new OwnVessel(store), () => reviewing);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.setOpacity?.(ctx, 0.8);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-symbol',
      'icon-opacity',
      0.8,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-stale',
      'icon-opacity',
      0.8,
    );
    reviewing = true;
    overlay.sync(ctx);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-symbol',
      'icon-opacity',
      0.8 * 0.35,
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-stale',
      'icon-opacity',
      0.8 * 0.35,
    );
    reviewing = false;
    overlay.sync(ctx);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-symbol',
      'icon-opacity',
      0.8,
    );
    expect(map.setPaintProperty).toHaveBeenLastCalledWith(
      'binnacle-own-vessel-stale',
      'icon-opacity',
      0.8,
    );
  });

  it('remove deletes the layer and source', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    overlay.remove(fakeOverlayContext(map));
    expect(map.layers.size).toBe(0);
    expect(map.sources.size).toBe(0);
  });

  it('projects the COG predictor for the shared ten-minute window', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    store.applyFrame({
      self: new Map<string, unknown>([
        ['navigation.position', { latitude: 0, longitude: 0 }],
        ['navigation.courseOverGroundTrue', Math.PI / 2],
        ['navigation.speedOverGround', 5],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1,
    });
    overlay.sync(ctx);
    const features = sourceFeatures<{
      geometry: { type: string; coordinates: [number, number][] };
    }>(map, 'binnacle-own-vessel-vector');
    expect(features).toHaveLength(1);
    const [origin, tip] = features[0].geometry.coordinates;
    expect(origin).toEqual([0, 0]);
    // Due east from the equator at 5 m/s for 600 s: 3,000 m, about 0.02698 degrees of longitude.
    expect(tip[0]).toBeCloseTo(3000 / ((6_371_000 * Math.PI) / 180), 5);
    expect(tip[1]).toBeCloseTo(0, 6);
  });

  it('hides the predictor below the COG-meaningful speed floor and without COG', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    store.applyFrame({
      self: new Map<string, unknown>([
        ['navigation.position', { latitude: 36.8, longitude: -121.7 }],
        ['navigation.courseOverGroundTrue', 1],
        ['navigation.speedOverGround', 0.1],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1,
    });
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-own-vessel-vector')).toHaveLength(0);

    store.applyFrame({
      self: new Map<string, unknown>([['navigation.speedOverGround', 2]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2,
    });
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-own-vessel-vector')).toHaveLength(1);
  });

  it('clears the predictor when a projection input goes server-stale', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    store.applyFrame({
      self: new Map<string, unknown>([
        ['navigation.position', { latitude: 36.8, longitude: -121.7 }],
        ['navigation.courseOverGroundTrue', 1],
        ['navigation.speedOverGround', 3],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1,
    });
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-own-vessel-vector')).toHaveLength(1);

    store.applyFrame({
      self: new Map(),
      selfStales: new Map([['navigation.speedOverGround', {}]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2,
    });
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-own-vessel-vector')).toHaveLength(0);
  });

  it('themes and dims the predictor line through the overlay paint pipeline', async () => {
    const store = new SignalKStore();
    const overlay = createVesselOverlay(new OwnVessel(store));
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.applyTheme?.(ctx, mapThemePaint('night-red'));
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-vector-line',
      'line-color',
      expect.stringMatching(/^rgba/),
    );
    overlay.setOpacity?.(ctx, 0.5);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-own-vessel-vector-line',
      'line-opacity',
      0.5 * 0.8,
    );
  });
});

// A manually driven stand-in for the requestAnimationFrame trio, so the frame-loop tests control
// both the schedule and the clock.
function fakeMotion() {
  let nowMs = 0;
  let nextHandle = 1;
  const pending = new Map<number, (t: number) => void>();
  const motion: VesselMotion = {
    schedule: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      pending.delete(handle);
    },
    now: () => nowMs,
  };
  return {
    motion,
    pendingFrames: () => pending.size,
    // Advance the clock without running a frame, for a tick-style sync between frames.
    setNow: (toMs: number) => {
      nowMs = toMs;
    },
    // Advance the clock and run the single pending frame, the way a display refresh would.
    step: (toMs: number) => {
      nowMs = toMs;
      const next = pending.entries().next().value;
      if (!next) throw new Error('no pending frame to run');
      pending.delete(next[0]);
      next[1](toMs);
    },
  };
}

function iconCoordinates(map: ReturnType<typeof createFakeMap>): [number, number] {
  const [feature] = sourceFeatures<{ geometry: { coordinates: [number, number] } }>(
    map,
    'binnacle-own-vessel',
  );
  return [...feature.geometry.coordinates];
}

const EAST = Math.PI / 2;

describe('vessel overlay dead reckoning', () => {
  async function mountUnderway(sogMps = 5) {
    const store = new SignalKStore();
    const fake = fakeMotion();
    const overlay = createVesselOverlay(new OwnVessel(store), () => false, fake.motion);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    store.applyFrame({
      self: new Map<string, unknown>([
        ['navigation.position', { latitude: 0, longitude: 0 }],
        ['navigation.courseOverGroundTrue', EAST],
        ['navigation.speedOverGround', sogMps],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1,
    });
    overlay.sync(ctx);
    return { store, fake, overlay, map, ctx };
  }

  it('advances the icon and the predictor origin together between fixes, capped at the horizon', async () => {
    const test = await mountUnderway();
    expect(iconCoordinates(test.map)).toEqual([0, 0]);
    expect(test.fake.pendingFrames()).toBe(1);

    test.fake.step(500);
    const reckoned = deadReckonedPosition(0, 0, EAST, 5, 500);
    expect(iconCoordinates(test.map)).toEqual([...reckoned]);
    const vector = sourceFeatures<{ geometry: { coordinates: [number, number][] } }>(
      test.map,
      'binnacle-own-vessel-vector',
    );
    expect(vector[0].geometry.coordinates[0]).toEqual([...reckoned]);
    expect(test.fake.pendingFrames()).toBe(1);

    // Past the horizon the ship holds at the last reckoned point and the loop stops.
    test.fake.step(5_000);
    expect(iconCoordinates(test.map)).toEqual([...deadReckonedPosition(0, 0, EAST, 5, 3_000)]);
    expect(test.fake.pendingFrames()).toBe(0);
  });

  it('converges onto a fresh fix instead of snapping, then rides the new reckoning', async () => {
    const test = await mountUnderway();
    test.fake.step(500);
    const drawnBefore = deadReckonedPosition(0, 0, EAST, 5, 1_000);
    // The next fix lands near the reckoning, inside the plausibility bound.
    const next = { latitude: 0.00001, longitude: drawnBefore[0] };
    test.store.applyFrame({
      self: new Map<string, unknown>([['navigation.position', next]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2,
    });
    test.fake.step(1_000);
    // The accepting frame still draws the previously reckoned point: no snap.
    expect(iconCoordinates(test.map)).toEqual([...drawnBefore]);

    // Past the convergence window the drawn position is exactly the new fix's reckoning.
    test.fake.step(1_300);
    expect(iconCoordinates(test.map)).toEqual([
      ...deadReckonedPosition(next.latitude, next.longitude, EAST, 5, 300),
    ]);
  });

  it('applies an implausible jump immediately', async () => {
    const test = await mountUnderway();
    test.fake.step(500);
    test.store.applyFrame({
      self: new Map<string, unknown>([['navigation.position', { latitude: 1, longitude: 1 }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2,
    });
    test.fake.step(1_000);
    expect(iconCoordinates(test.map)).toEqual([1, 1]);
  });

  it('leaves the loop off and draws the raw fix below the COG-meaningful speed floor', async () => {
    const test = await mountUnderway(0.1);
    expect(test.fake.pendingFrames()).toBe(0);
    expect(iconCoordinates(test.map)).toEqual([0, 0]);
  });

  it('lets the frame loop own the writes while it is animating', async () => {
    const test = await mountUnderway();
    test.fake.step(500);
    const drawn = iconCoordinates(test.map);
    test.store.applyFrame({
      self: new Map<string, unknown>([
        ['navigation.position', { latitude: 0.00001, longitude: drawn[0] }],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2,
    });
    // A tick sync between frames must not double-write past the loop.
    test.fake.setNow(700);
    test.overlay.sync(test.ctx);
    expect(iconCoordinates(test.map)).toEqual(drawn);
    test.fake.step(750);
    expect(iconCoordinates(test.map)).not.toEqual(drawn);
  });

  it('stops the loop while the layer is hidden and resumes when shown again', async () => {
    const test = await mountUnderway();
    expect(test.fake.pendingFrames()).toBe(1);
    test.overlay.setVisible?.(test.ctx, false);
    expect(test.fake.pendingFrames()).toBe(0);
    test.overlay.sync(test.ctx);
    expect(test.fake.pendingFrames()).toBe(0);

    test.overlay.setVisible?.(test.ctx, true);
    test.overlay.sync(test.ctx);
    expect(test.fake.pendingFrames()).toBe(1);
  });

  it('remove cancels the pending frame', async () => {
    const test = await mountUnderway();
    expect(test.fake.pendingFrames()).toBe(1);
    test.overlay.remove(test.ctx);
    expect(test.fake.pendingFrames()).toBe(0);
  });
});

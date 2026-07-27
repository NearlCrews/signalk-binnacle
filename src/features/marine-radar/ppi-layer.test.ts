import { describe, expect, it, vi } from 'vitest';
import { createFakeMap, fakeOverlayContext, sourceFeatures } from '$shared/testing';
import { MarineRadarStore } from './marine-radar-store.svelte';
import {
  createPpiLayer,
  RADAR_ECHO_LAYER_ID,
  RADAR_RING_LABELS_LAYER_ID,
  RADAR_RINGS_LAYER_ID,
} from './ppi-layer';
import type { RadarFrame } from './radar-frame-core';

const RINGS_SOURCE_ID = 'marine-radar-rings-src';
// Three rings, each a line feature plus a label point, and the heading line last.
const RING_AND_LABEL_COUNT = 6;

function frameOf(range = 1852): RadarFrame {
  return { buffer: new ArrayBuffer(8), spokesPerRev: 16, maxSpokeLen: 8, range, spokeCount: 1 };
}

describe('createPpiLayer', () => {
  it('declares the marine-radar identity, the traffic band, and its managed layer ids', () => {
    const layer = createPpiLayer(new MarineRadarStore(), () => ({ latitude: 0, longitude: 0 }));
    expect(layer.id).toBe('marine-radar');
    expect(layer.title).toBe('Radar');
    expect(layer.band).toBe('traffic');
    expect(layer.supportsOpacity).toBe(true);
    expect(layer.defaultVisible).toBe(false);
    expect(layer.layerIds).toEqual([
      RADAR_ECHO_LAYER_ID,
      RADAR_RINGS_LAYER_ID,
      RADAR_RING_LABELS_LAYER_ID,
    ]);
  });

  it('never uses the reserved weather radar id', () => {
    const layer = createPpiLayer(new MarineRadarStore(), () => undefined);
    expect(layer.id).not.toBe('weather-radar');
    expect(layer.layerIds).not.toContain('weather-radar');
  });

  it('reuses the cached ring and label features when only the heading changes', async () => {
    const store = new MarineRadarStore();
    let heading = 0;
    const layer = createPpiLayer(
      store,
      () => ({ latitude: 10, longitude: 20 }),
      () => heading,
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await layer.add(ctx);
    layer.pushFrame(frameOf());
    layer.sync(ctx);
    const before = sourceFeatures(map, RINGS_SOURCE_ID);
    expect(before).toHaveLength(RING_AND_LABEL_COUNT + 1);

    heading = Math.PI / 2;
    layer.sync(ctx);
    const after = sourceFeatures(map, RINGS_SOURCE_ID);
    expect(after).toHaveLength(RING_AND_LABEL_COUNT + 1);
    // Underway the heading updates several times per second while the fix holds still, so the
    // geodesic ring and label geometry must be reused by identity, with only the heading line new.
    for (let i = 0; i < RING_AND_LABEL_COUNT; i += 1) expect(after[i]).toBe(before[i]);
    expect(after[RING_AND_LABEL_COUNT]).not.toBe(before[RING_AND_LABEL_COUNT]);
  });

  it('skips the rings write entirely when position, range, and heading hold still', async () => {
    const store = new MarineRadarStore();
    const layer = createPpiLayer(
      store,
      () => ({ latitude: 10, longitude: 20 }),
      () => 0,
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await layer.add(ctx);
    layer.pushFrame(frameOf());
    layer.sync(ctx);
    const source = map.sources.get(RINGS_SOURCE_ID);
    if (!source) throw new Error(`${RINGS_SOURCE_ID} not added`);
    const spy = vi.spyOn(source, 'setData');
    layer.sync(ctx);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rebuilds the rings when the vessel position changes', async () => {
    const store = new MarineRadarStore();
    let latitude = 10;
    const layer = createPpiLayer(
      store,
      () => ({ latitude, longitude: 20 }),
      () => 0,
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await layer.add(ctx);
    layer.pushFrame(frameOf());
    layer.sync(ctx);
    const before = sourceFeatures(map, RINGS_SOURCE_ID);

    latitude = 10.01;
    layer.sync(ctx);
    const after = sourceFeatures(map, RINGS_SOURCE_ID);
    expect(after).toHaveLength(RING_AND_LABEL_COUNT + 1);
    expect(after[0]).not.toBe(before[0]);
  });

  it('is unavailable with a hint until a radar is discovered, and is manageable', () => {
    const store = new MarineRadarStore();
    const layer = createPpiLayer(store, () => ({ latitude: 0, longitude: 0 }));
    expect(layer.available?.()).toBe(false);
    expect(layer.unavailableHint).toBeTruthy();
    expect(layer.manageable).toBe(true);
    store.setDiscovered([
      {
        id: 'a',
        name: 'A',
        status: 'standby',
        spokesPerRevolution: 16,
        maxSpokeLen: 8,
        range: 100,
        controls: {},
      },
    ]);
    expect(layer.available?.()).toBe(true);
  });
});

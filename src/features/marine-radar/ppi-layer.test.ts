import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapThemePaint } from '$shared/map';
import { createFakeMap, fakeOverlayContext, sourceFeatures } from '$shared/testing';
import { MarineRadarStore } from './marine-radar-store.svelte';
import {
  createPpiLayer,
  RADAR_AREAS_FILL_LAYER_ID,
  RADAR_AREAS_LINE_LAYER_ID,
  RADAR_AREAS_SOURCE_ID,
  RADAR_ECHO_LAYER_ID,
  RADAR_RING_LABELS_LAYER_ID,
  RADAR_RINGS_LAYER_ID,
} from './ppi-layer';
import type { RadarFrame } from './radar-frame-core';
import { makeRadar } from './radar-test-fixtures';

// A recording RadarGl stand-in so the echo custom layer's onAdd and render can run without a real
// WebGL2 context. Only the tests that drive render construct one.
const glInstances = vi.hoisted(
  () => [] as Array<Record<'setData' | 'setLegend' | 'setHeading', ReturnType<typeof vi.fn>>>,
);
vi.mock('./radar-gl', () => ({
  RadarGl: class {
    setData = vi.fn();
    setLegend = vi.fn();
    setOpacity = vi.fn();
    setHeading = vi.fn();
    setSweep = vi.fn();
    setSweepColor = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    constructor() {
      glInstances.push(this as never);
    }
  },
}));

const RINGS_SOURCE_ID = 'marine-radar-rings-src';
// Three rings, each a line feature plus a label point, and the heading line last.
const RING_AND_LABEL_COUNT = 6;

function frameOf(range = 1852, heading?: number): RadarFrame {
  return {
    buffer: new ArrayBuffer(8),
    spokesPerRev: 16,
    maxSpokeLen: 8,
    range,
    heading,
    spokeCount: 1,
  };
}

const discoveredRadar = () => makeRadar({ status: 'transmit', controls: {} });

// Mounts the echo custom layer far enough to drive its render callback directly: the fake map
// records the layer, onAdd builds the mocked RadarGl, and the returned args carry a 16-entry main
// matrix the way MapLibre's render call does.
async function mountEcho(
  options: {
    getCenter?: () => { latitude: number; longitude: number } | undefined;
    getHeading?: () => number | undefined;
    centerFresh?: () => boolean;
  } = {},
) {
  vi.stubGlobal('document', new EventTarget());
  const store = new MarineRadarStore();
  const layer = createPpiLayer(
    store,
    options.getCenter ?? (() => ({ latitude: 10, longitude: 20 })),
    options.getHeading ?? (() => 0),
    undefined,
    { center: options.centerFresh },
  );
  const map = createFakeMap();
  const ctx = fakeOverlayContext(map);
  await layer.add(ctx);
  const echo = map.layers.get(RADAR_ECHO_LAYER_ID) as unknown as {
    onAdd: (map: unknown, gl: unknown) => void;
    render: (gl: unknown, args: unknown) => void;
  };
  echo.onAdd(map, {});
  layer.setVisible(ctx, true);
  const gl = glInstances.at(-1);
  if (!gl) throw new Error('expected a RadarGl instance');
  return {
    store,
    layer,
    map,
    ctx,
    echo,
    gl,
    renderArgs: { defaultProjectionData: { mainMatrix: new Array(16).fill(0) as number[] } },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  glInstances.length = 0;
});

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
      RADAR_AREAS_FILL_LAYER_ID,
      RADAR_AREAS_LINE_LAYER_ID,
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
    store.setDiscovered([makeRadar({ range: 100, controls: {} })]);
    expect(layer.available?.()).toBe(true);
  });

  it('routes deliberate chart points into the active structured draft', () => {
    const store = new MarineRadarStore();
    store.setDiscovered([
      makeRadar({
        range: 1_000,
        controls: { noTransmitSector1: { value: -1, endValue: 1, enabled: false } },
      }),
    ]);
    store.setCapabilities([
      {
        id: 'noTransmitSector1',
        name: 'No-transmit sector 1',
        dialect: 'native',
        type: 'sector',
        range: { min: -Math.PI, max: Math.PI, unit: 'rad' },
        hasEnabled: true,
      },
    ]);
    store.setAreaDraft({
      radarId: 'a',
      controlId: 'noTransmitSector1',
      type: 'sector',
      value: { value: -1, endValue: 1, enabled: false },
      chartEditing: true,
      chartStep: 0,
    });
    const layer = createPpiLayer(
      store,
      () => ({ latitude: 0, longitude: 0 }),
      () => 0,
    );

    expect(layer.chartEditing()).toBe(true);
    expect(layer.handleChartPoint({ latitude: 0.01, longitude: 0 })).toBe(true);
    expect(store.areaDraft?.chartStep).toBe(1);
    expect(layer.handleChartPoint({ latitude: 0, longitude: 0.01 })).toBe(true);
    expect(layer.chartEditing()).toBe(false);
  });

  it('uses the spoke-frame heading and range for radar-area geometry', async () => {
    const store = new MarineRadarStore();
    store.setDiscovered([
      makeRadar({
        status: 'transmit',
        range: 4_000,
        controls: { noTransmitSector1: { value: 0, endValue: Math.PI / 2, enabled: true } },
      }),
    ]);
    store.setCapabilities([
      {
        id: 'noTransmitSector1',
        name: 'No-transmit sector 1',
        dialect: 'native',
        type: 'sector',
        range: { min: -Math.PI, max: Math.PI, unit: 'rad' },
        hasEnabled: true,
      },
    ]);
    const layer = createPpiLayer(
      store,
      () => ({ latitude: 42, longitude: -83 }),
      () => undefined,
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await layer.add(ctx);

    layer.pushFrame(frameOf(4_000, Math.PI / 4));
    layer.sync(ctx);
    const before = sourceFeatures(map, RADAR_AREAS_SOURCE_ID);
    expect(before).toHaveLength(1);

    layer.pushFrame(frameOf(2_000, Math.PI / 4));
    layer.sync(ctx);
    const after = sourceFeatures(map, RADAR_AREAS_SOURCE_ID);
    expect(after).toHaveLength(1);
    expect(after[0]?.geometry).not.toEqual(before[0]?.geometry);
  });

  it('stops chart placement and reports when heading freshness is lost between taps', () => {
    const store = new MarineRadarStore();
    store.setDiscovered([
      makeRadar({
        status: 'transmit',
        range: 1_000,
        controls: { noTransmitSector1: { value: -1, endValue: 1, enabled: false } },
      }),
    ]);
    store.setCapabilities([
      {
        id: 'noTransmitSector1',
        name: 'No-transmit sector 1',
        dialect: 'native',
        type: 'sector',
        range: { min: -Math.PI, max: Math.PI, unit: 'rad' },
        hasEnabled: true,
      },
    ]);
    store.setAreaDraft({
      radarId: 'a',
      controlId: 'noTransmitSector1',
      type: 'sector',
      value: { value: -1, endValue: 1, enabled: false },
      chartEditing: true,
      chartStep: 1,
    });
    const layer = createPpiLayer(
      store,
      () => ({ latitude: 0, longitude: 0 }),
      () => 0,
      undefined,
      { heading: () => false },
    );

    expect(layer.handleChartPoint({ latitude: 0, longitude: 0.01 })).toBe(false);
    expect(layer.chartEditing()).toBe(false);
    expect(store.areaDraft?.chartError).toContain('heading');
  });

  it('updates the echo heading every render, not only when a new frame arrives', async () => {
    let heading = 0;
    const { store, layer, echo, gl, renderArgs } = await mountEcho({ getHeading: () => heading });
    store.setDiscovered([discoveredRadar()]);
    layer.pushFrame(frameOf(1852, undefined));

    echo.render({}, renderArgs);
    expect(gl.setHeading).toHaveBeenLastCalledWith(0);
    expect(gl.setData).toHaveBeenCalledTimes(1);

    heading = Math.PI / 2;
    echo.render({}, renderArgs);
    expect(gl.setHeading).toHaveBeenLastCalledWith(Math.PI / 2);
    // The frame upload stays dirty-gated; only the heading uniform tracks the live value.
    expect(gl.setData).toHaveBeenCalledTimes(1);
  });

  it('reapplies a changed legend for the same radar id', async () => {
    const { store, layer, ctx, gl } = await mountEcho();
    store.setDiscovered([{ ...discoveredRadar(), legend: [{ color: '#00ff00', label: 'weak' }] }]);
    layer.sync(ctx);
    const applied = gl.setLegend.mock.calls.length;
    layer.sync(ctx);
    expect(gl.setLegend.mock.calls.length).toBe(applied);

    store.setDiscovered([
      { ...discoveredRadar(), legend: [{ color: '#ff0000', label: 'doppler' }] },
    ]);
    layer.sync(ctx);
    expect(gl.setLegend.mock.calls.length).toBe(applied + 1);
  });

  it('reports blocked for a stale or missing fix and withdraws it when the frame clears', async () => {
    let centerFresh = true;
    let center: { latitude: number; longitude: number } | undefined;
    const { store, layer, echo, renderArgs } = await mountEcho({
      getCenter: () => center,
      centerFresh: () => centerFresh,
    });
    store.setDiscovered([discoveredRadar()]);
    layer.pushFrame(frameOf(1852, 0));

    echo.render({}, renderArgs);
    expect(store.rendererStatus).toBe('blocked');
    expect(store.rendererDetail).toContain('No own-vessel position');

    centerFresh = false;
    echo.render({}, renderArgs);
    expect(store.rendererStatus).toBe('blocked');
    expect(store.rendererDetail).toContain('stale');

    layer.clearFrame();
    expect(store.rendererStatus).toBe('ready');

    store.setRendererStatus('error', 'WebGL initialization failed.');
    layer.clearFrame();
    expect(store.rendererStatus).toBe('error');
  });

  it('uses zero-blue night vector colors, with green only where AA text needs it', async () => {
    const layer = createPpiLayer(
      new MarineRadarStore(),
      () => ({ latitude: 0, longitude: 0 }),
      () => 0,
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await layer.add(ctx);
    layer.applyTheme?.(ctx, mapThemePaint('night-red'));

    for (const [layerId, property] of [
      [RADAR_AREAS_FILL_LAYER_ID, 'fill-color'],
      [RADAR_AREAS_LINE_LAYER_ID, 'line-color'],
      [RADAR_RINGS_LAYER_ID, 'line-color'],
      [RADAR_RING_LABELS_LAYER_ID, 'text-color'],
    ]) {
      const color = map.setPaintProperty.mock.calls.find(
        ([candidateLayer, candidateProperty]) =>
          candidateLayer === layerId && candidateProperty === property,
      )?.[2];
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      if (typeof color !== 'string') throw new Error('expected a radar vector color');
      const green = Number.parseInt(color.slice(3, 5), 16);
      const blue = Number.parseInt(color.slice(5, 7), 16);
      expect(blue, `${layerId} blue channel`).toBe(0);
      // Ring label text carries the theme's night text tone (bounded green buys its 4.5:1 AA on
      // true black, matching tokens.css); the non-text vectors stay pure red.
      if (layerId === RADAR_RING_LABELS_LAYER_ID) {
        const red = Number.parseInt(color.slice(1, 3), 16);
        expect(green).toBeGreaterThan(0);
        expect(green / red).toBeLessThanOrEqual(0.5);
      } else {
        expect(green, `${layerId} green channel`).toBe(0);
      }
    }
  });
});

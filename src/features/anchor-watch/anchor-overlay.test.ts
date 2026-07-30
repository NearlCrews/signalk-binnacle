import { describe, expect, it, vi } from 'vitest';
import { AnchorWatch } from '$entities/anchor';
import { OwnVessel } from '$entities/vessel';
import { mapThemePaint } from '$shared/map';
import { SignalKStore } from '$shared/signalk';
import {
  createFakeMap,
  createFakeStorage,
  createFrameFactory,
  fakeOverlayContext,
  sourceFeatures,
} from '$shared/testing';
import { createAnchorOverlay } from './anchor-overlay';

const frame = createFrameFactory();

function setup() {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  const anchor = new AnchorWatch(store, vessel, createFakeStorage());
  const map = createFakeMap();
  const overlay = createAnchorOverlay(anchor, vessel);
  const ctx = fakeOverlayContext(map);
  return { store, vessel, anchor, map, overlay, ctx };
}

describe('anchor overlay', () => {
  it('adds its sources and layers', async () => {
    const { map, overlay, ctx } = setup();
    await overlay.add(ctx);
    expect(map.sources.has('binnacle-anchor-shapes')).toBe(true);
    expect(map.sources.has('binnacle-anchor-point')).toBe(true);
    for (const id of overlay.layerIds) {
      expect(map.layers.has(id)).toBe(true);
    }
  });

  it('renders nothing while no anchor is down', async () => {
    const { map, overlay, ctx } = setup();
    await overlay.add(ctx);
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-anchor-shapes')).toHaveLength(0);
    expect(sourceFeatures(map, 'binnacle-anchor-point')).toHaveLength(0);
  });

  it('renders the swing circle, rode line, and marker for a watch', async () => {
    const { store, anchor, map, overlay, ctx } = setup();
    await overlay.add(ctx);
    anchor.dropLocal({ latitude: 0, longitude: 0 }, 50);
    store.applyFrame(frame({ 'navigation.position': { latitude: 0.0002, longitude: 0 } }));
    overlay.sync(ctx);
    const shapes = sourceFeatures(map, 'binnacle-anchor-shapes');
    expect(shapes.map((f) => f.geometry.type).sort()).toEqual(['LineString', 'Polygon']);
    expect(sourceFeatures(map, 'binnacle-anchor-point')).toHaveLength(1);
  });

  it('splits a rode line that crosses the antimeridian', async () => {
    const { store, anchor, map, overlay, ctx } = setup();
    await overlay.add(ctx);
    anchor.dropLocal({ latitude: 10, longitude: 179 }, 50);
    store.applyFrame(frame({ 'navigation.position': { latitude: 12, longitude: -179 } }));
    overlay.sync(ctx);

    const rode = sourceFeatures(map, 'binnacle-anchor-shapes').find(
      (feature) => feature.properties?.rode === true,
    );
    expect(rode?.geometry.type).toBe('MultiLineString');
  });

  it('skips the redraw when nothing changed, and clears after a raise', async () => {
    const { anchor, map, overlay, ctx } = setup();
    await overlay.add(ctx);
    anchor.dropLocal({ latitude: 0, longitude: 0 }, 50);
    overlay.sync(ctx);
    const source = map.sources.get('binnacle-anchor-shapes');
    if (!source) throw new Error('missing source');
    const before = source.data;
    overlay.sync(ctx);
    expect(source.data).toBe(before);
    anchor.raiseLocal();
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-anchor-shapes')).toHaveLength(0);
  });

  it('marks the features as dragging once the watch latches', async () => {
    const { store, anchor, map, overlay, ctx } = setup();
    await overlay.add(ctx);
    anchor.dropLocal({ latitude: 0, longitude: 0 }, 50);
    const outside = { latitude: 0.001, longitude: 0 };
    for (let i = 0; i < 3; i += 1) {
      store.applyFrame(frame({ 'navigation.position': outside }));
      anchor.updateFix();
    }
    overlay.sync(ctx);
    expect(sourceFeatures(map, 'binnacle-anchor-point')[0]?.properties?.dragging).toBe(true);
  });

  it('toggles visibility across all of its layers', async () => {
    const { map, overlay, ctx } = setup();
    await overlay.add(ctx);
    overlay.setVisible(ctx, false);
    const hidden = map.setLayoutProperty.mock.calls.filter((call) => call[2] === 'none');
    expect(hidden).toHaveLength(overlay.layerIds.length);
  });

  it('absorbs an opacity or theme change that lands before add attaches the layers', async () => {
    const { map, overlay, ctx } = setup();
    expect(() => overlay.setOpacity?.(ctx, 0.5)).not.toThrow();
    expect(() => overlay.applyTheme?.(ctx, mapThemePaint('night-red'))).not.toThrow();
    expect(map.setPaintProperty).not.toHaveBeenCalled();

    await overlay.add(ctx);
    overlay.setOpacity?.(ctx, 0.5);
    overlay.applyTheme?.(ctx, mapThemePaint('night-red'));
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      'binnacle-anchor-swing-ring',
      'line-opacity',
      0.5,
    );
    expect(map.setPaintProperty.mock.calls.some((call) => call[1] === 'circle-stroke-color')).toBe(
      true,
    );
  });
});

// The drag handlers register through on, once, and off; the shared fake map stubs those out, so
// this local extension keeps real listener bookkeeping and lets a test fire map events.
type FiredHandler = (e: unknown) => void;

function eventfulMap() {
  const base = createFakeMap();
  const listeners = new Map<string, Set<FiredHandler>>();
  const onceListeners = new Map<string, Set<FiredHandler>>();
  const canvas = { style: { cursor: '' } };
  const key = (type: string, layer?: string) => (layer === undefined ? type : `${type}:${layer}`);
  const add = (bag: Map<string, Set<FiredHandler>>, k: string, handler: FiredHandler) => {
    const set = bag.get(k) ?? new Set<FiredHandler>();
    set.add(handler);
    bag.set(k, set);
  };
  return {
    ...base,
    on(type: string, layerOrHandler: string | FiredHandler, maybeHandler?: FiredHandler) {
      if (typeof layerOrHandler === 'function') add(listeners, key(type), layerOrHandler);
      else if (maybeHandler) add(listeners, key(type, layerOrHandler), maybeHandler);
    },
    once(type: string, handler: FiredHandler) {
      add(onceListeners, key(type), handler);
    },
    off(type: string, handler: FiredHandler) {
      listeners.get(key(type))?.delete(handler);
      onceListeners.get(key(type))?.delete(handler);
    },
    fire(type: string, e: unknown, layer?: string) {
      const k = key(type, layer);
      for (const handler of [...(listeners.get(k) ?? [])]) handler(e);
      const armed = onceListeners.get(k);
      if (armed) {
        const handlers = [...armed];
        armed.clear();
        for (const handler of handlers) handler(e);
      }
    },
    getCanvas: () => canvas,
  };
}

function touchEvent(lat: number, lng: number) {
  return { points: [{ x: 0, y: 0 }], preventDefault: () => {}, lngLat: { lat, lng } };
}

function markerCoords(map: ReturnType<typeof eventfulMap>): unknown {
  const feature = sourceFeatures(map as never, 'binnacle-anchor-point')[0];
  const geometry = feature?.geometry as GeoJSON.Point | undefined;
  return geometry?.coordinates;
}

async function dragSetup(interactionsAllowed: () => boolean = () => true) {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  const anchor = new AnchorWatch(store, vessel, createFakeStorage());
  anchor.dropLocal({ latitude: 0, longitude: 0 }, 50);
  const onMoved = vi.fn();
  const overlay = createAnchorOverlay(anchor, vessel, onMoved, interactionsAllowed);
  const map = eventfulMap();
  const ctx = fakeOverlayContext(map);
  await overlay.add(ctx);
  overlay.sync(ctx);
  return { map, overlay, ctx, onMoved };
}

describe('anchor overlay marker drag', () => {
  it('commits the drag preview on touchend, once', async () => {
    const { map, overlay, ctx, onMoved } = await dragSetup();
    map.fire('touchstart', touchEvent(1, 1), 'binnacle-anchor-marker');
    map.fire('touchmove', touchEvent(2, 2));
    overlay.sync(ctx);
    expect(markerCoords(map)).toEqual([2, 2]);
    map.fire('touchend', touchEvent(3, 3));
    expect(onMoved).toHaveBeenCalledTimes(1);
    expect(onMoved).toHaveBeenCalledWith({ latitude: 2, longitude: 2 });
    // The armed touchcancel was removed with the drag; a stray one later changes nothing.
    map.fire('touchcancel', touchEvent(4, 4));
    overlay.sync(ctx);
    expect(onMoved).toHaveBeenCalledTimes(1);
  });

  it('abandons the drag on touchcancel without relocating the anchor', async () => {
    const { map, overlay, ctx, onMoved } = await dragSetup();
    map.fire('touchstart', touchEvent(1, 1), 'binnacle-anchor-marker');
    map.fire('touchmove', touchEvent(2, 2));
    map.fire('touchcancel', touchEvent(2, 2));
    overlay.sync(ctx);
    expect(markerCoords(map)).toEqual([0, 0]);
    // A later pan plus lift must not silently move the drop point: the move and end handlers
    // were detached with the cancel.
    map.fire('touchmove', touchEvent(5, 5));
    map.fire('touchend', touchEvent(5, 5));
    overlay.sync(ctx);
    expect(markerCoords(map)).toEqual([0, 0]);
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('blocks and cancels drag when another chart tool owns interactions', async () => {
    let allowed = false;
    const { map, overlay, ctx, onMoved } = await dragSetup(() => allowed);
    map.fire('touchstart', touchEvent(1, 1), 'binnacle-anchor-marker');
    map.fire('touchmove', touchEvent(2, 2));
    map.fire('touchend', touchEvent(2, 2));
    expect(onMoved).not.toHaveBeenCalled();

    allowed = true;
    map.fire('touchstart', touchEvent(1, 1), 'binnacle-anchor-marker');
    map.fire('touchmove', touchEvent(2, 2));
    overlay.sync(ctx);
    expect(markerCoords(map)).toEqual([2, 2]);
    allowed = false;
    overlay.sync(ctx);
    map.fire('touchend', touchEvent(3, 3));
    overlay.sync(ctx);
    expect(markerCoords(map)).toEqual([0, 0]);
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('cancels drag and cursor ownership when hidden or fully transparent', async () => {
    const { map, overlay, ctx, onMoved } = await dragSetup();
    map.fire('mouseenter', {}, 'binnacle-anchor-marker');
    expect(map.getCanvas().style.cursor).toBe('move');

    map.fire('touchstart', touchEvent(1, 1), 'binnacle-anchor-marker');
    map.fire('touchmove', touchEvent(2, 2));
    overlay.setOpacity?.(ctx, 0);
    expect(map.getCanvas().style.cursor).toBe('');
    map.fire('touchend', touchEvent(3, 3));
    expect(onMoved).not.toHaveBeenCalled();

    overlay.setOpacity?.(ctx, 1);
    map.fire('touchstart', touchEvent(1, 1), 'binnacle-anchor-marker');
    map.fire('touchmove', touchEvent(2, 2));
    overlay.setVisible(ctx, false);
    map.fire('touchend', touchEvent(3, 3));
    overlay.sync(ctx);
    expect(markerCoords(map)).toEqual([0, 0]);
    expect(onMoved).not.toHaveBeenCalled();
  });
});

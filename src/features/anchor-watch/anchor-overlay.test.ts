import { describe, expect, it, vi } from 'vitest';
import { AnchorWatch } from '$entities/anchor';
import { OwnVessel } from '$entities/vessel';
import type { OverlayContext } from '$shared/map';
import { SignalKStore } from '$shared/signalk';
import { createFakeMap } from '$shared/testing/fake-map';
import { createFakeStorage } from '$shared/testing/fake-storage';
import { createFrameFactory } from '$shared/testing/sk-frame';
import { createAnchorOverlay } from './anchor-overlay';

function ctxFor(map: ReturnType<typeof createFakeMap>): OverlayContext {
  return { map: map as never, beforeIdFor: () => undefined };
}

const frame = createFrameFactory();

function setup() {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  const anchor = new AnchorWatch(store, vessel, createFakeStorage());
  const map = createFakeMap();
  const overlay = createAnchorOverlay(anchor, vessel);
  const ctx = ctxFor(map);
  return { store, vessel, anchor, map, overlay, ctx };
}

function features(map: ReturnType<typeof createFakeMap>, src: string): GeoJSON.Feature[] {
  const data = map.sources.get(src)?.data as GeoJSON.FeatureCollection | undefined;
  return data?.features ?? [];
}

describe('anchor overlay', () => {
  it('adds its sources and layers', () => {
    const { map, overlay, ctx } = setup();
    overlay.add(ctx);
    expect(map.sources.has('binnacle-anchor-shapes')).toBe(true);
    expect(map.sources.has('binnacle-anchor-point')).toBe(true);
    for (const id of overlay.layerIds) {
      expect(map.layers.has(id)).toBe(true);
    }
  });

  it('renders nothing while no anchor is down', () => {
    const { map, overlay, ctx } = setup();
    overlay.add(ctx);
    overlay.sync(ctx);
    expect(features(map, 'binnacle-anchor-shapes')).toHaveLength(0);
    expect(features(map, 'binnacle-anchor-point')).toHaveLength(0);
  });

  it('renders the swing circle, rode line, and marker for a watch', () => {
    const { store, anchor, map, overlay, ctx } = setup();
    overlay.add(ctx);
    anchor.dropLocal({ latitude: 0, longitude: 0 }, 50);
    store.applyFrame(frame({ 'navigation.position': { latitude: 0.0002, longitude: 0 } }));
    overlay.sync(ctx);
    const shapes = features(map, 'binnacle-anchor-shapes');
    expect(shapes.map((f) => f.geometry.type).sort()).toEqual(['LineString', 'Polygon']);
    expect(features(map, 'binnacle-anchor-point')).toHaveLength(1);
  });

  it('skips the redraw when nothing changed, and clears after a raise', () => {
    const { anchor, map, overlay, ctx } = setup();
    overlay.add(ctx);
    anchor.dropLocal({ latitude: 0, longitude: 0 }, 50);
    overlay.sync(ctx);
    const source = map.sources.get('binnacle-anchor-shapes');
    if (!source) throw new Error('missing source');
    const before = source.data;
    overlay.sync(ctx);
    expect(source.data).toBe(before);
    anchor.raiseLocal();
    overlay.sync(ctx);
    expect(features(map, 'binnacle-anchor-shapes')).toHaveLength(0);
  });

  it('marks the features as dragging once the watch latches', () => {
    const { store, anchor, map, overlay, ctx } = setup();
    overlay.add(ctx);
    anchor.dropLocal({ latitude: 0, longitude: 0 }, 50);
    const outside = { latitude: 0.001, longitude: 0 };
    for (let i = 0; i < 3; i += 1) {
      store.applyFrame(frame({ 'navigation.position': outside }));
      anchor.updateFix();
    }
    overlay.sync(ctx);
    expect(features(map, 'binnacle-anchor-point')[0]?.properties?.dragging).toBe(true);
  });

  it('toggles visibility across all of its layers', () => {
    const { map, overlay, ctx } = setup();
    overlay.add(ctx);
    overlay.setVisible(ctx, false);
    const hidden = map.setLayoutProperty.mock.calls.filter((call) => call[2] === 'none');
    expect(hidden).toHaveLength(overlay.layerIds.length);
  });
});

// The drag handlers register through on, once, and off; the shared fake map stubs those out, so
// this local extension keeps real listener bookkeeping and lets a test fire map events.
type FiredHandler = (e: unknown) => void;

function eventfulMap() {
  const base = createFakeMap();
  const listeners = new Map<string, Set<FiredHandler>>();
  const onceListeners = new Map<string, Set<FiredHandler>>();
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
    getCanvas: () => ({ style: { cursor: '' } }),
  };
}

function touchEvent(lat: number, lng: number) {
  return { points: [{ x: 0, y: 0 }], preventDefault: () => {}, lngLat: { lat, lng } };
}

function markerCoords(map: ReturnType<typeof eventfulMap>): unknown {
  const feature = features(map as never, 'binnacle-anchor-point')[0];
  const geometry = feature?.geometry as GeoJSON.Point | undefined;
  return geometry?.coordinates;
}

function dragSetup() {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  const anchor = new AnchorWatch(store, vessel, createFakeStorage());
  anchor.dropLocal({ latitude: 0, longitude: 0 }, 50);
  const onMoved = vi.fn();
  const overlay = createAnchorOverlay(anchor, vessel, onMoved);
  const map = eventfulMap();
  const ctx: OverlayContext = { map: map as never, beforeIdFor: () => undefined };
  overlay.add(ctx);
  overlay.sync(ctx);
  return { map, overlay, ctx, onMoved };
}

describe('anchor overlay marker drag', () => {
  it('commits the drag preview on touchend, once', () => {
    const { map, overlay, ctx, onMoved } = dragSetup();
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

  it('abandons the drag on touchcancel without relocating the anchor', () => {
    const { map, overlay, ctx, onMoved } = dragSetup();
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
});

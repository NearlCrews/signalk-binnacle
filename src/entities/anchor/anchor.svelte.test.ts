import { describe, expect, it } from 'vitest';
import { OwnVessel } from '$entities/vessel';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage, createFrameFactory } from '$shared/testing';
import { AnchorWatch } from './anchor.svelte';
import { DEFAULT_RADIUS_M } from './anchor-geometry';

const frame = createFrameFactory();

// About 111 meters per 0.001 degree of latitude, so these fixes sit well outside a 50 m radius.
const ANCHOR = { latitude: 0, longitude: 0 };
const INSIDE = { latitude: 0.0002, longitude: 0 };
const OUTSIDE = { latitude: 0.001, longitude: 0 };

function setup(seed?: Record<string, string>) {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  const anchor = new AnchorWatch(store, vessel, createFakeStorage(seed));
  const fix = (position: { latitude: number; longitude: number }) => {
    store.applyFrame(frame({ 'navigation.position': position }));
    anchor.updateFix();
  };
  return { store, anchor, fix };
}

describe('AnchorWatch (client mode)', () => {
  it('starts off, drops at a position, and raises clean', () => {
    const { anchor } = setup();
    expect(anchor.mode).toBe('off');
    anchor.dropLocal(ANCHOR, 50);
    expect(anchor.mode).toBe('client');
    expect(anchor.position).toEqual(ANCHOR);
    expect(anchor.radiusMeters).toBe(50);
    anchor.raiseLocal();
    expect(anchor.mode).toBe('off');
    expect(anchor.position).toBeUndefined();
  });

  it('reports the live distance from the anchor to the boat', () => {
    const { anchor, fix } = setup();
    anchor.dropLocal(ANCHOR, 50);
    fix(OUTSIDE);
    expect(anchor.distanceMeters).toBeCloseTo(111.19, 0);
  });

  it('reports fixLost and degraded when the fix goes stale during a client watch', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 100_000 });
    const vessel = new OwnVessel(store, clock);
    const anchor = new AnchorWatch(store, vessel, createFakeStorage());
    // A local frame factory aligned with the clock, so the fix starts fresh, not already stale.
    const freshFrame = createFrameFactory(99_000);
    store.applyFrame(freshFrame({ 'navigation.position': INSIDE }));
    anchor.dropLocal(ANCHOR, 50);
    expect(anchor.fixLost).toBe(false);
    expect(anchor.degraded).toBe(false);
    // The fix dropout passes the staleness window: client drag detection is silently dead.
    clock.now += 60_000;
    expect(anchor.fixLost).toBe(true);
    expect(anchor.degraded).toBe(true);
  });

  it('latches dragging after three consecutive fixes outside the radius', () => {
    const { anchor, fix } = setup();
    anchor.dropLocal(ANCHOR, 50);
    fix(OUTSIDE);
    fix(OUTSIDE);
    expect(anchor.dragging).toBe(false);
    fix(OUTSIDE);
    expect(anchor.dragging).toBe(true);
  });

  it('does not latch on scattered breaches separated by inside fixes', () => {
    const { anchor, fix } = setup();
    anchor.dropLocal(ANCHOR, 50);
    fix(OUTSIDE);
    fix(OUTSIDE);
    fix(INSIDE);
    fix(OUTSIDE);
    fix(OUTSIDE);
    expect(anchor.dragging).toBe(false);
  });

  it('keeps the latch when the boat swings back inside, until acknowledged', () => {
    const { anchor, fix } = setup();
    anchor.dropLocal(ANCHOR, 50);
    fix(OUTSIDE);
    fix(OUTSIDE);
    fix(OUTSIDE);
    fix(INSIDE);
    expect(anchor.dragging).toBe(true);
    anchor.acknowledge();
    expect(anchor.dragging).toBe(false);
  });

  it('re-latches after an acknowledge if the boat keeps dragging', () => {
    const { anchor, fix } = setup();
    anchor.dropLocal(ANCHOR, 50);
    fix(OUTSIDE);
    fix(OUTSIDE);
    fix(OUTSIDE);
    anchor.acknowledge();
    expect(anchor.dragging).toBe(false);
    fix(OUTSIDE);
    fix(OUTSIDE);
    fix(OUTSIDE);
    expect(anchor.dragging).toBe(true);
  });

  it('a radius change restarts the breach window', () => {
    const { anchor, fix } = setup();
    anchor.dropLocal(ANCHOR, 50);
    fix(OUTSIDE);
    fix(OUTSIDE);
    anchor.setRadiusLocal(60);
    fix(OUTSIDE);
    fix(OUTSIDE);
    expect(anchor.dragging).toBe(false);
    fix(OUTSIDE);
    expect(anchor.dragging).toBe(true);
  });

  it('persists the watch (including the latch) and restores it on construction', () => {
    const storage = createFakeStorage();
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    const first = new AnchorWatch(store, vessel, storage);
    first.dropLocal(ANCHOR, 42);
    const restored = new AnchorWatch(new SignalKStore(), vessel, storage);
    expect(restored.mode).toBe('client');
    expect(restored.position).toEqual(ANCHOR);
    expect(restored.radiusMeters).toBe(42);
  });

  it('rejects a corrupted persisted watch', () => {
    const storage = createFakeStorage({
      'binnacle:anchor-watch': JSON.stringify({ position: { latitude: 'x' }, radiusMeters: -1 }),
    });
    const store = new SignalKStore();
    const anchor = new AnchorWatch(store, new OwnVessel(store), storage);
    expect(anchor.mode).toBe('off');
  });

  it('drops unknown persisted properties instead of re-persisting them forever', () => {
    const storage = createFakeStorage({
      'binnacle:anchor-watch': JSON.stringify({
        position: { latitude: 1, longitude: 2, altitude: 9 },
        radiusMeters: 60,
        dragging: false,
        legacy: true,
      }),
    });
    const store = new SignalKStore();
    const anchor = new AnchorWatch(store, new OwnVessel(store), storage);
    anchor.setRadiusLocal(70); // any local change re-persists the watch
    expect(JSON.parse(storage.data.get('binnacle:anchor-watch') ?? 'null')).toEqual({
      position: { latitude: 1, longitude: 2 },
      radiusMeters: 70,
      dragging: false,
    });
  });

  it('clamps the radius to the minimum and ignores a non-finite one', () => {
    const { anchor } = setup();
    anchor.dropLocal(ANCHOR, 50);
    anchor.setRadiusLocal(2);
    expect(anchor.radiusMeters).toBe(10);
    anchor.setRadiusLocal(Number.NaN);
    expect(anchor.radiusMeters).toBe(10);
  });

  it('remembers the preferred radius for the next drop', () => {
    const { anchor } = setup();
    expect(anchor.preferredRadiusMeters).toBe(DEFAULT_RADIUS_M);
    anchor.rememberRadius(75);
    expect(anchor.preferredRadiusMeters).toBe(75);
    anchor.dropLocal(ANCHOR);
    expect(anchor.radiusMeters).toBe(75);
  });

  it('moving the anchor keeps the watch and restarts detection', () => {
    const { anchor, fix } = setup();
    anchor.dropLocal(ANCHOR, 50);
    fix(OUTSIDE);
    fix(OUTSIDE);
    anchor.movePositionLocal({ latitude: 0.001, longitude: 0 });
    expect(anchor.position).toEqual({ latitude: 0.001, longitude: 0 });
    fix(OUTSIDE);
    expect(anchor.dragging).toBe(false);
  });
});

describe('AnchorWatch (server mode)', () => {
  it('reflects a server watch from the stream cells', () => {
    const { store, anchor } = setup();
    store.applyFrame(
      frame({
        'navigation.anchor.position': ANCHOR,
        'navigation.anchor.maxRadius': 60,
      }),
    );
    expect(anchor.mode).toBe('server');
    expect(anchor.position).toEqual(ANCHOR);
    expect(anchor.radiusMeters).toBe(60);
  });

  it('clears when the plugin raises the anchor (position goes null)', () => {
    const { store, anchor } = setup();
    store.applyFrame(frame({ 'navigation.anchor.position': ANCHOR }));
    expect(anchor.watching).toBe(true);
    store.applyFrame(frame({ 'navigation.anchor.position': null }));
    expect(anchor.mode).toBe('off');
  });

  it('grades dragging from the anchor notification', () => {
    const { store, anchor } = setup();
    store.applyFrame(frame({ 'navigation.anchor.position': ANCHOR }));
    expect(anchor.dragging).toBe(false);
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'emergency', message: 'dragging' } }),
    );
    expect(anchor.dragging).toBe(true);
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'normal', message: 'ok' } }),
    );
    expect(anchor.dragging).toBe(false);
  });

  it('acknowledge silences the current grade and re-arms once the server clears', () => {
    const { store, anchor, fix } = setup();
    store.applyFrame(
      frame({
        'navigation.anchor.position': ANCHOR,
        'notifications.navigation.anchor': { state: 'emergency', message: 'dragging' },
      }),
    );
    anchor.acknowledge();
    expect(anchor.acknowledged).toBe(true);
    // Server clears, then alarms again: the old acknowledge must not silence the new alarm.
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'normal', message: 'ok' } }),
    );
    fix(INSIDE);
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'emergency', message: 'dragging' } }),
    );
    expect(anchor.acknowledged).toBe(false);
  });

  it('drops a lingering local watch once the server watch appears', () => {
    const { store, anchor, fix } = setup();
    anchor.dropLocal(ANCHOR, 50);
    store.applyFrame(frame({ 'navigation.anchor.position': ANCHOR }));
    fix(INSIDE);
    store.applyFrame(frame({ 'navigation.anchor.position': null }));
    expect(anchor.mode).toBe('off');
  });

  it('re-arms acknowledge when the server escalates to a more severe grade', () => {
    const { store, anchor, fix } = setup();
    // Put the anchor into server mode by publishing a position cell.
    store.applyFrame(frame({ 'navigation.anchor.position': ANCHOR }));
    // Raise an alarm-grade drag notification and acknowledge it (alarm and emergency are the
    // anchor-drag grades; warn is not a dragging state).
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'alarm', message: 'dragging' } }),
    );
    fix(INSIDE);
    anchor.acknowledge();
    expect(anchor.acknowledged).toBe(true);
    // The server escalates to emergency: the acknowledge must not suppress the new grade.
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { state: 'emergency', message: 'dragging!' } }),
    );
    expect(anchor.acknowledged).toBe(false);
  });
});

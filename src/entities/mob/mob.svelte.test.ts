import { describe, expect, it } from 'vitest';
import { OwnVessel } from '$entities/vessel';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage, createFrameFactory } from '$shared/testing';
import { MobStore } from './mob.svelte';

const frame = createFrameFactory();

const BOAT = { latitude: 36.8, longitude: -121.79 };

function setup(seed?: Record<string, string>) {
  const store = new SignalKStore();
  const vessel = new OwnVessel(store);
  const clock = $state({ now: 100_000 });
  const mob = new MobStore(store, vessel, clock, createFakeStorage(seed));
  return { store, vessel, clock, mob };
}

describe('MobStore', () => {
  it('is inactive until triggered, and triggers position-less without a fix', () => {
    const { mob, clock } = setup();
    expect(mob.active).toBe(false);
    // An MOB without a fix is still an MOB: the alarm raises, with no mark to steer to.
    const mark = mob.trigger();
    expect(mark).toEqual({ epochMs: clock.now });
    expect(mob.active).toBe(true);
    expect(mob.position).toBeUndefined();
  });

  it('captures a snapshot without committing, and trigger commits a passed capture', () => {
    const { store, mob, clock } = setup();
    expect(mob.capture()).toBeUndefined();
    store.applyFrame(frame({ 'navigation.position': BOAT }));
    const pressed = mob.capture();
    expect(pressed).toEqual({ position: BOAT, epochMs: clock.now });
    expect(mob.active).toBe(false);
    // The boat moves between press and confirm; the committed mark stays at the press fix.
    store.applyFrame(
      frame({
        'navigation.position': { latitude: BOAT.latitude + 0.01, longitude: BOAT.longitude },
      }),
    );
    clock.now += 10_000;
    expect(mob.trigger(pressed)).toEqual(pressed);
    expect(mob.position).toEqual(BOAT);
  });

  it('ages a capture on the store clock, and treats no clock as unknown age', () => {
    const { store, mob, clock } = setup();
    store.applyFrame(frame({ 'navigation.position': BOAT }));
    const pressed = mob.capture();
    if (!pressed) throw new Error('expected a capture');
    expect(mob.captureAgeMs(pressed)).toBe(0);
    clock.now += 45_000;
    expect(mob.captureAgeMs(pressed)).toBe(45_000);
    const clockless = new MobStore(store, new OwnVessel(store), undefined, createFakeStorage());
    expect(clockless.captureAgeMs(pressed)).toBeUndefined();
  });

  it('marks the boat position and time on trigger, and cancel clears it', () => {
    const { store, mob, clock } = setup();
    store.applyFrame(frame({ 'navigation.position': BOAT }));
    const mark = mob.trigger();
    expect(mark).toEqual({ position: BOAT, epochMs: clock.now });
    // The mark is published to the stream worker via postMessage, so it must be a plain object:
    // a reactive proxy leaking through here throws DataCloneError and the alarm never goes out.
    expect(() => structuredClone(mark)).not.toThrow();
    expect(mob.active).toBe(true);
    expect(mob.position).toEqual(BOAT);
    expect(mob.markEpochMs).toBe(clock.now);
    mob.cancel();
    expect(mob.active).toBe(false);
    expect(mob.position).toBeUndefined();
  });

  it('persists the mark and restores it on construction', () => {
    const storage = createFakeStorage();
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(frame({ 'navigation.position': BOAT }));
    const clock = $state({ now: 5000 });
    new MobStore(store, vessel, clock, storage).trigger();
    const restored = new MobStore(new SignalKStore(), vessel, undefined, storage);
    expect(restored.active).toBe(true);
    expect(restored.position).toEqual(BOAT);
  });

  it('rejects a corrupted persisted mark', () => {
    const { mob } = setup({ 'binnacle:mob': JSON.stringify({ position: 7 }) });
    expect(mob.active).toBe(false);
  });

  it('restores a persisted position-less mark', () => {
    const { mob } = setup({ 'binnacle:mob': JSON.stringify({ epochMs: 5000 }) });
    expect(mob.active).toBe(true);
    expect(mob.position).toBeUndefined();
    expect(mob.markEpochMs).toBe(5000);
  });

  it('strips unknown persisted properties from the restored mark', () => {
    // A persisted mark with stray keys (a legacy field, an extra coordinate) restores as a clean
    // literal, so nothing downstream re-persists or publishes the extras.
    const { mob } = setup({
      'binnacle:mob': JSON.stringify({
        position: { latitude: 1, longitude: 2, altitude: 9 },
        epochMs: 5000,
        legacy: true,
      }),
    });
    expect(mob.position).toEqual({ latitude: 1, longitude: 2 });
    expect(mob.markEpochMs).toBe(5000);
  });

  it('ticks the elapsed time on the clock', () => {
    const { store, mob, clock } = setup();
    store.applyFrame(frame({ 'navigation.position': BOAT }));
    mob.trigger();
    clock.now += 95_000;
    expect(mob.elapsedSeconds).toBe(95);
  });

  it('computes live bearing and range from the boat back to the mark', () => {
    const { store, mob } = setup();
    store.applyFrame(frame({ 'navigation.position': BOAT }));
    mob.trigger();
    // The boat drifts north of the mark, so the way back is due south at about 111 m.
    store.applyFrame(
      frame({
        'navigation.position': { latitude: BOAT.latitude + 0.001, longitude: BOAT.longitude },
      }),
    );
    expect(mob.distanceMeters).toBeCloseTo(111.19, 0);
    expect(((mob.bearingRad ?? 0) * 180) / Math.PI).toBeCloseTo(180, 1);
  });

  it('blanks bearing and range while the own fix is stale', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 100_000 });
    const vessel = new OwnVessel(store, clock);
    const mob = new MobStore(store, vessel, clock, createFakeStorage());
    // A local frame factory aligned with the clock, so the fix starts fresh, not already stale.
    const freshFrame = createFrameFactory(99_000);
    store.applyFrame(freshFrame({ 'navigation.position': BOAT }));
    mob.trigger();
    store.applyFrame(
      freshFrame({
        'navigation.position': { latitude: BOAT.latitude + 0.001, longitude: BOAT.longitude },
      }),
    );
    clock.now = 101_000;
    expect(mob.bearingRad).toBeDefined();
    expect(mob.distanceMeters).toBeDefined();
    // The fix dropout passes the staleness window: frozen guidance must blank to dashes.
    clock.now += 60_000;
    expect(mob.bearingRad).toBeUndefined();
    expect(mob.distanceMeters).toBeUndefined();
  });

  it('acknowledge silences without clearing, and a new trigger re-arms', () => {
    const { store, mob } = setup();
    store.applyFrame(frame({ 'navigation.position': BOAT }));
    mob.trigger();
    mob.acknowledge();
    expect(mob.acknowledged).toBe(true);
    expect(mob.active).toBe(true);
    mob.trigger();
    expect(mob.acknowledged).toBe(false);
  });

  it('does not capture an old position after the connection generation changes', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 1000 });
    const vessel = new OwnVessel(store, clock);
    const mob = new MobStore(store, vessel, clock, createFakeStorage());
    store.applyFrame({ ...frame({ 'navigation.position': BOAT }), generation: 1 });
    expect(mob.capture()?.position).toEqual(BOAT);
    store.applyFrame({ ...frame({}), generation: 2 });
    expect(mob.capture()).toBeUndefined();
  });

  it('re-arms a remote alarm after it clears and is raised again', () => {
    const { store, mob } = setup();
    const emergency = { state: 'emergency', message: 'Man overboard' };
    store.applyFrame(frame({ 'notifications.mob': emergency }));
    mob.acknowledge();
    expect(mob.acknowledged).toBe(true);
    store.applyFrame(frame({ 'notifications.mob': { state: 'normal' } }));
    expect(mob.acknowledged).toBe(false);
    store.applyFrame(frame({ 'notifications.mob': emergency }));
    expect(mob.active).toBe(true);
    expect(mob.acknowledged).toBe(false);
  });

  it('re-arms when a remote alert arrives after the local MOB was acknowledged', () => {
    const { store, mob } = setup();
    store.applyFrame(frame({ 'navigation.position': BOAT }));
    mob.trigger();
    mob.acknowledge();
    expect(mob.acknowledged).toBe(true);

    store.applyFrame(
      frame({
        'notifications.mob.remote': {
          id: 'remote',
          state: 'emergency',
          message: 'Man overboard',
        },
      }),
    );
    expect(mob.acknowledged).toBe(false);
    mob.acknowledge();
    expect(mob.acknowledged).toBe(true);
  });

  it('reflects a remote MOB notification, with its mark when carried', () => {
    const { store, mob } = setup();
    store.applyFrame(
      frame({
        'notifications.mob': {
          state: 'emergency',
          message: 'Man overboard',
          position: { latitude: 1, longitude: 2 },
        },
      }),
    );
    expect(mob.active).toBe(true);
    expect(mob.position).toEqual({ latitude: 1, longitude: 2 });
    expect(mob.elapsedSeconds).toBeUndefined();
    store.applyFrame(frame({ 'notifications.mob': { state: 'normal', message: 'cleared' } }));
    expect(mob.active).toBe(false);
  });

  it('aggregates v2 MOB notification paths and exposes their ids for recovery', () => {
    const { store, mob } = setup();
    store.applyFrame(
      frame({
        'notifications.mob.mob-1': {
          id: 'mob-1',
          state: 'emergency',
          message: 'Man overboard',
          position: { latitude: 1, longitude: 2 },
        },
      }),
    );
    expect(mob.active).toBe(true);
    expect(mob.position).toEqual({ latitude: 1, longitude: 2 });
    expect(mob.remoteNotificationIds).toEqual(['mob-1']);
    store.applyFrame(frame({ 'notifications.mob.mob-1': { state: 'normal' } }));
    expect(mob.active).toBe(false);
  });

  it('updates a remote MOB position when the sounding notification changes only its position', () => {
    const { store, mob } = setup();
    const notification = {
      id: 'mob-1',
      state: 'emergency',
      message: 'Man overboard',
    };
    store.applyFrame(
      frame({
        'notifications.mob.mob-1': {
          ...notification,
          position: { latitude: 1, longitude: 2 },
        },
      }),
    );
    expect(mob.position).toEqual({ latitude: 1, longitude: 2 });
    store.applyFrame(
      frame({
        'notifications.mob.mob-1': {
          ...notification,
          position: { latitude: 3, longitude: 4 },
        },
      }),
    );
    expect(mob.position).toEqual({ latitude: 3, longitude: 4 });
  });

  it('caps remote sounding notifications and rejects unsafe notification ids', () => {
    const { store, mob } = setup();
    const notifications = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [
        `notifications.mob.${index}`,
        { id: `mob-${index}`, state: 'emergency', message: 'Man overboard' },
      ]),
    );
    store.applyFrame(frame(notifications));
    expect(mob.remoteNotificationIds).toHaveLength(500);
    expect(mob.remoteNotificationIds).not.toContain('mob-500');

    const { store: validationStore, mob: validationMob } = setup();
    validationStore.applyFrame(
      frame({
        'notifications.mob.valid': {
          id: 'a'.repeat(512),
          state: 'emergency',
          message: 'Man overboard',
        },
        'notifications.mob.long': {
          id: 'b'.repeat(513),
          state: 'emergency',
          message: 'Man overboard',
        },
        'notifications.mob.control': {
          id: '\nbad-value',
          state: 'emergency',
          message: 'Man overboard',
        },
        'notifications.mob.padded': {
          id: ' padded ',
          state: 'emergency',
          message: 'Man overboard',
        },
      }),
    );
    expect(validationMob.remoteNotificationIds).toEqual(['a'.repeat(512)]);
  });

  it('rejects an invalid runtime mark without changing local or persisted state', () => {
    const { mob } = setup();
    expect(() => mob.trigger({ epochMs: Number.NaN })).toThrow('Invalid man-overboard mark');
    expect(mob.active).toBe(false);
  });

  it('prefers the local mark over a remote position', () => {
    const { store, mob } = setup();
    store.applyFrame(frame({ 'navigation.position': BOAT }));
    mob.trigger();
    store.applyFrame(
      frame({
        'notifications.mob': {
          state: 'emergency',
          message: 'Man overboard',
          position: { latitude: 1, longitude: 2 },
        },
      }),
    );
    expect(mob.position).toEqual(BOAT);
  });
});

import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { SignalKStore } from './store.svelte';
import type { SKFrame } from './types';

function frame(self: Record<string, unknown>): SKFrame {
  return {
    self: new Map(Object.entries(self)) as SKFrame['self'],
    connection: { phase: 'open', attempt: 0 },
    epoch: 1000,
  };
}

// Build the frame's nested AIS Map from a readable record literal.
function aisMap(record: Record<string, Record<string, unknown>>): SKFrame['ais'] {
  return new Map(Object.entries(record).map(([ctx, vals]) => [ctx, new Map(Object.entries(vals))]));
}

describe('SignalKStore', () => {
  it('exposes the latest value of a path through its cell', () => {
    const store = new SignalKStore();
    store.applyFrame(frame({ 'navigation.speedOverGround': 5.1 }));
    expect(store.cell('navigation.speedOverGround').value).toBe(5.1);
  });

  it('stores source metadata for a self path when the frame provides it', () => {
    const store = new SignalKStore();
    store.applyFrame({
      self: new Map([['navigation.speedOverGround', 5.1]]),
      selfSources: new Map([['navigation.speedOverGround', { label: 'NMEA2000.35' }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    expect(store.cell('navigation.speedOverGround').source?.label).toBe('NMEA2000.35');
  });

  it('clears source metadata when a later frame for the path has no source', () => {
    const store = new SignalKStore();
    store.applyFrame({
      self: new Map([['navigation.speedOverGround', 5.1]]),
      selfSources: new Map([['navigation.speedOverGround', { label: 'NMEA2000.35' }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    store.applyFrame(frame({ 'navigation.speedOverGround': 5.2 }));
    expect(store.cell('navigation.speedOverGround').source).toBeUndefined();
  });

  it('bumps aisVersion only when a context actually updates', () => {
    const store = new SignalKStore();
    const before = store.aisVersion;
    // An empty ais object (a self-only worker frame) must not bump the version,
    // or the consumers' version guards would fire every frame.
    store.applyFrame({
      self: new Map(),
      ais: aisMap({}),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    expect(store.aisVersion).toBe(before);
    store.applyFrame({
      self: new Map(),
      ais: aisMap({ 'vessels.a': { name: 'A' } }),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1001,
    });
    expect(store.aisVersion).toBe(before + 1);
  });

  it('updates connection state reactively', () => {
    const store = new SignalKStore();
    store.applyFrame(frame({}));
    expect(store.connection.phase).toBe('open');
  });

  it('stamps each self cell with the frame epoch for staleness', () => {
    const store = new SignalKStore();
    expect(store.cell('navigation.position').epoch).toBe(0);
    store.applyFrame({
      self: new Map([['navigation.position', { latitude: 0, longitude: 0 }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1234,
    });
    expect(store.cell('navigation.position').epoch).toBe(1234);
  });

  it('uses per-path receipt times and stamps the active connection generation', () => {
    const store = new SignalKStore();
    store.applyFrame({
      self: new Map([['navigation.position', { latitude: 0, longitude: 0 }]]),
      selfEpochs: new Map([['navigation.position', 900]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
      generation: 2,
    });
    expect(store.generation).toBe(2);
    expect(store.cell('navigation.position').epoch).toBe(900);
    expect(store.cell('navigation.position').generation).toBe(2);
  });

  it('ignores a late frame from an older connection generation', () => {
    const store = new SignalKStore();
    store.applyFrame({ ...frame({ 'navigation.speedOverGround': 5 }), generation: 2 });
    expect(
      store.applyFrame({
        ...frame({ 'navigation.speedOverGround': 99 }),
        generation: 1,
        connection: { phase: 'closed', attempt: 9 },
      }),
    ).toBe(false);

    expect(store.generation).toBe(2);
    expect(store.cell('navigation.speedOverGround').value).toBe(5);
    expect(store.connection.phase).not.toBe('closed');
  });

  it('tracks notification clear and re-raise activations without clearing the latch on reconnect', () => {
    const store = new SignalKStore();
    const emergency = { state: 'emergency', message: 'MOB' };
    store.applyFrame({ ...frame({ 'notifications.mob': emergency }), generation: 1 });
    expect(store.cell('notifications.mob').activation).toBe(1);
    store.applyFrame({ ...frame({}), generation: 2 });
    expect(store.cell('notifications.mob').activation).toBe(1);
    store.applyFrame({ ...frame({ 'notifications.mob': emergency }), generation: 2 });
    expect(store.cell('notifications.mob').activation).toBe(1);
    store.applyFrame({ ...frame({ 'notifications.mob': null }), generation: 2 });
    store.applyFrame({ ...frame({ 'notifications.mob': emergency }), generation: 2 });
    expect(store.cell('notifications.mob').activation).toBe(2);
  });

  it('reacts only for the changed cell, not unrelated cells', () => {
    const store = new SignalKStore();
    const cleanup = $effect.root(() => {
      let windRuns = 0;
      const wind = store.cell('environment.wind.speedApparent');
      $effect(() => {
        void wind.value;
        windRuns += 1;
      });
      flushSync();
      expect(windRuns).toBe(1);
      store.applyFrame(frame({ 'navigation.speedOverGround': 6 }));
      flushSync();
      expect(windRuns).toBe(1);
      store.applyFrame(frame({ 'environment.wind.speedApparent': 9 }));
      flushSync();
      expect(windRuns).toBe(2);
    });
    cleanup();
  });

  it('does not retrigger connection consumers when phase and attempt are unchanged', () => {
    const store = new SignalKStore();
    const cleanup = $effect.root(() => {
      let runs = 0;
      $effect(() => {
        void store.connection;
        runs += 1;
      });
      flushSync();
      expect(runs).toBe(1);
      // The worker sends a fresh connection object per frame; an unchanged state must not re-run.
      store.applyFrame(frame({ 'navigation.speedOverGround': 1 }));
      store.applyFrame(frame({ 'navigation.speedOverGround': 2 }));
      flushSync();
      expect(runs).toBe(2);
      store.applyFrame(frame({ 'navigation.speedOverGround': 3 }));
      flushSync();
      expect(runs).toBe(2);
      store.applyFrame({
        self: new Map(),
        connection: { phase: 'reconnecting', attempt: 1 },
        epoch: 2000,
      });
      flushSync();
      expect(runs).toBe(3);
    });
    cleanup();
  });

  it('applies ais targets from the frame', () => {
    const store = new SignalKStore();
    store.applyFrame({
      self: new Map(),
      ais: aisMap({ 'vessels.a': { 'navigation.speedOverGround': 4 } }),
      connection: { phase: 'open', attempt: 0 },
      epoch: 5,
    });
    expect(store.aisTargets.get('vessels.a')?.values.get('navigation.speedOverGround')).toBe(4);
    expect(store.aisTargets.get('vessels.a')?.lastUpdate).toBe(5);
  });

  it('merges later ais updates and refreshes lastUpdate', () => {
    const store = new SignalKStore();
    const aisFrame = (epoch: number, value: number): SKFrame => ({
      self: new Map(),
      ais: aisMap({ 'vessels.a': { 'navigation.speedOverGround': value } }),
      connection: { phase: 'open', attempt: 0 },
      epoch,
    });
    store.applyFrame(aisFrame(1, 4));
    store.applyFrame(aisFrame(2, 6));
    expect(store.aisTargets.get('vessels.a')?.values.get('navigation.speedOverGround')).toBe(6);
    expect(store.aisTargets.get('vessels.a')?.lastUpdate).toBe(2);
  });

  it('mirrors notifications.* values into the notifications map and bumps the version', () => {
    const store = new SignalKStore();
    const before = store.notificationsVersion;
    const value = { state: 'alarm', method: ['visual'], message: 'Dragging' };
    store.applyFrame(frame({ 'notifications.navigation.anchor': value }));
    expect(store.notifications.get('notifications.navigation.anchor')).toBe(value);
    expect(store.notificationsVersion).toBe(before + 1);
    // The keyed consumers (anchor drag, MOB) still read the per-path cell.
    expect(store.cell('notifications.navigation.anchor').value).toBe(value);
  });

  it('does not bump the notifications version for non-notification paths', () => {
    const store = new SignalKStore();
    const before = store.notificationsVersion;
    store.applyFrame(frame({ 'navigation.speedOverGround': 5 }));
    expect(store.notificationsVersion).toBe(before);
    expect(store.notifications.size).toBe(0);
  });

  it('removes a notification cleared with a null value', () => {
    const store = new SignalKStore();
    store.applyFrame(frame({ 'notifications.mob': { state: 'emergency', message: 'MOB' } }));
    store.applyFrame(frame({ 'notifications.mob': null }));
    expect(store.notifications.has('notifications.mob')).toBe(false);
    expect(store.notificationsVersion).toBe(2);
  });

  it('suppresses the version bump when a notification republishes unchanged', () => {
    const store = new SignalKStore();
    const status = { silenced: false, acknowledged: false, canSilence: true, canAcknowledge: true };
    const raise = { state: 'alarm', message: 'Dragging', id: 'abc', status };
    store.applyFrame(frame({ 'notifications.navigation.anchor': raise }));
    expect(store.notificationsVersion).toBe(1);
    // A persistent alarm republished identically every cycle (a fresh object, same content) must
    // not rebuild the consumers' lists per frame.
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { ...raise, status: { ...status } } }),
    );
    expect(store.notificationsVersion).toBe(1);
    // A status flag flip is a real change and must bump.
    store.applyFrame(
      frame({
        'notifications.navigation.anchor': { ...raise, status: { ...status, silenced: true } },
      }),
    );
    expect(store.notificationsVersion).toBe(2);
  });

  it('captures the self context from the first frame that carries it', () => {
    const store = new SignalKStore();
    expect(store.selfContext).toBeUndefined();
    store.applyFrame({ ...frame({}), selfContext: 'vessels.urn:mrn:imo:mmsi:230099999' });
    expect(store.selfContext).toBe('vessels.urn:mrn:imo:mmsi:230099999');
    // A later frame without the field must not clear it.
    store.applyFrame(frame({}));
    expect(store.selfContext).toBe('vessels.urn:mrn:imo:mmsi:230099999');
  });

  it('removes a notification whose value has no state, without a version bump for a no-op', () => {
    const store = new SignalKStore();
    store.applyFrame(frame({ 'notifications.x': { message: 'no state' } }));
    expect(store.notifications.size).toBe(0);
    // Clearing a path that was never mirrored must not bump the version.
    expect(store.notificationsVersion).toBe(0);
  });

  it('prunes targets older than the ttl', () => {
    const store = new SignalKStore();
    store.applyFrame({
      self: new Map(),
      ais: aisMap({ 'vessels.a': { name: 'A' }, 'vessels.b': { name: 'B' } }),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    store.applyFrame({
      self: new Map(),
      ais: aisMap({ 'vessels.b': { name: 'B' } }),
      connection: { phase: 'open', attempt: 0 },
      epoch: 400000,
    });
    const removed = store.pruneAis(400000, 360000);
    expect(removed).toBe(1);
    expect(store.aisTargets.has('vessels.a')).toBe(false);
    expect(store.aisTargets.has('vessels.b')).toBe(true);
  });
});

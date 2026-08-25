import { describe, expect, it } from 'vitest';
import { predatesReconnect, SignalKStore } from './store.svelte';
import type { SKFrame } from './types';
import { notificationState } from './types';

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

describe('predatesReconnect', () => {
  it('never predates when the cell epoch is zero, the seeded-and-never-streamed state', () => {
    expect(predatesReconnect({ epoch: 0, generation: 0 }, 5)).toBe(false);
    expect(predatesReconnect({ epoch: 0, generation: 3 }, 5)).toBe(false);
  });

  it('is false when the cell generation matches the store generation', () => {
    expect(predatesReconnect({ epoch: 1000, generation: 5 }, 5)).toBe(false);
  });

  it('is true when a real value carries a generation that differs from the store', () => {
    expect(predatesReconnect({ epoch: 1000, generation: 4 }, 5)).toBe(true);
  });
});

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

  it('holds aisVersion steady when a target republishes an identical value', () => {
    const store = new SignalKStore();
    const position = { latitude: 42, longitude: -83 };
    store.applyFrame({
      self: new Map(),
      ais: aisMap({ 'vessels.a': { 'navigation.position': position } }),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    const after = store.aisVersion;
    // A target at anchor keeps transmitting the same fix. Bumping on that made the list, the
    // collision assessment, and the traffic overlays rebuild and re-clone the whole fleet for
    // nothing. A fresh object with equal fields is what actually arrives off the wire.
    store.applyFrame({
      self: new Map(),
      ais: aisMap({ 'vessels.a': { 'navigation.position': { latitude: 42, longitude: -83 } } }),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2000,
    });
    expect(store.aisVersion).toBe(after);
  });

  it('still advances freshness on an identical republish, so the target does not age out', () => {
    const store = new SignalKStore();
    const send = (epoch: number) =>
      store.applyFrame({
        self: new Map(),
        ais: aisMap({ 'vessels.a': { 'navigation.position': { latitude: 42, longitude: -83 } } }),
        connection: { phase: 'open', attempt: 0 },
        epoch,
      });
    send(1000);
    send(60_000);
    expect(store.pruneAis(70_000, 30_000)).toBe(0);
  });

  it('bumps aisVersion when a republished value actually differs', () => {
    const store = new SignalKStore();
    store.applyFrame({
      self: new Map(),
      ais: aisMap({ 'vessels.a': { 'navigation.position': { latitude: 42, longitude: -83 } } }),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    const after = store.aisVersion;
    store.applyFrame({
      self: new Map(),
      ais: aisMap({ 'vessels.a': { 'navigation.position': { latitude: 42.001, longitude: -83 } } }),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2000,
    });
    expect(store.aisVersion).toBe(after + 1);
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

  it('traces source handoffs only for opted-in paths, quietly on repeats', () => {
    const store = new SignalKStore();
    store.traceSources(['navigation.speedOverGround']);
    const withSource = (label: string, epoch: number): SKFrame => ({
      self: new Map([['navigation.speedOverGround', 5]]),
      selfSources: new Map([['navigation.speedOverGround', { label }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch,
    });
    store.applyFrame(withSource('gps.1', 1000));
    store.applyFrame(withSource('gps.1', 2000));
    store.applyFrame(withSource('gps.2', 3000));
    expect(store.cell('navigation.speedOverGround').sourceTrace).toEqual([
      { label: 'gps.1', epoch: 1000 },
      { label: 'gps.2', epoch: 3000 },
    ]);

    // An untraced path records nothing.
    store.applyFrame({
      self: new Map([['environment.depth.belowTransducer', 3]]),
      selfSources: new Map([['environment.depth.belowTransducer', { label: 'sounder.1' }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 4000,
    });
    expect(store.cell('environment.depth.belowTransducer').sourceTrace).toEqual([]);
  });

  it('does not read a metadata gap as a source handoff', () => {
    const store = new SignalKStore();
    store.traceSources(['navigation.speedOverGround']);
    store.applyFrame({
      self: new Map([['navigation.speedOverGround', 5]]),
      selfSources: new Map([['navigation.speedOverGround', { label: 'gps.1' }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    // A frame with no source metadata, then the same source again: no handoff happened.
    store.applyFrame(frame({ 'navigation.speedOverGround': 5.1 }));
    store.applyFrame({
      self: new Map([['navigation.speedOverGround', 5.2]]),
      selfSources: new Map([['navigation.speedOverGround', { label: 'gps.1' }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 3000,
    });
    expect(store.cell('navigation.speedOverGround').sourceTrace).toHaveLength(1);
  });

  it('bounds the trace and drops the oldest transitions first', () => {
    const store = new SignalKStore();
    store.traceSources(['navigation.speedOverGround']);
    for (let index = 0; index < 12; index += 1) {
      store.applyFrame({
        self: new Map([['navigation.speedOverGround', index]]),
        selfSources: new Map([['navigation.speedOverGround', { label: `gps.${index}` }]]),
        connection: { phase: 'open', attempt: 0 },
        epoch: 1000 + index,
      });
    }
    const trace = store.cell('navigation.speedOverGround').sourceTrace;
    expect(trace).toHaveLength(8);
    expect(trace[0]?.label).toBe('gps.4');
    expect(trace.at(-1)?.label).toBe('gps.11');
  });

  it('clears traces on a reconnect generation so old transitions cannot leak', () => {
    const store = new SignalKStore();
    store.traceSources(['navigation.speedOverGround']);
    store.applyFrame({
      self: new Map([['navigation.speedOverGround', 5]]),
      selfSources: new Map([['navigation.speedOverGround', { label: 'gps.1' }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
      generation: 1,
    });
    store.applyFrame({
      self: new Map([['navigation.speedOverGround', 6]]),
      selfSources: new Map([['navigation.speedOverGround', { label: 'gps.2' }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2000,
      generation: 1,
    });
    expect(store.cell('navigation.speedOverGround').sourceTrace).toHaveLength(2);
    store.applyFrame({
      self: new Map([['navigation.speedOverGround', 7]]),
      selfSources: new Map([['navigation.speedOverGround', { label: 'gps.2' }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 3000,
      generation: 2,
    });
    expect(store.cell('navigation.speedOverGround').sourceTrace).toEqual([
      { label: 'gps.2', epoch: 3000 },
    ]);
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

  it('updates the notification mirror when only acknowledgedAt changes', () => {
    const store = new SignalKStore();
    const status = {
      silenced: false,
      acknowledged: true,
      acknowledgedAt: '2026-08-12T03:00:00Z',
      canSilence: true,
      canAcknowledge: false,
    };
    const raised = { state: 'alarm', message: 'Dragging', status };
    store.applyFrame(frame({ 'notifications.navigation.anchor': raised }));
    const before = store.notificationsVersion;
    store.applyFrame(
      frame({
        'notifications.navigation.anchor': {
          ...raised,
          status: { ...status, acknowledgedAt: '2026-08-12T03:01:00Z' },
        },
      }),
    );
    expect(store.notificationsVersion).toBe(before + 1);
  });

  it('updates the mirror when only the delivery method changes, so an escalation to sound lands', () => {
    const store = new SignalKStore();
    const raise = { state: 'alarm', message: 'Dragging', id: 'abc', method: ['visual'] };
    store.applyFrame(frame({ 'notifications.navigation.anchor': raise }));
    const before = store.notificationsVersion;
    // The producer re-publishes the same alarm with sound added; the audible gate reads the
    // mirror, so an unchanged mirror would keep this station silent.
    const escalated = { ...raise, method: ['visual', 'sound'] };
    store.applyFrame(frame({ 'notifications.navigation.anchor': escalated }));
    expect(store.notificationsVersion).toBe(before + 1);
    expect(store.notifications.get('notifications.navigation.anchor')).toBe(escalated);
    // An identical method list on the next cycle is not a change.
    store.applyFrame(
      frame({ 'notifications.navigation.anchor': { ...escalated, method: ['visual', 'sound'] } }),
    );
    expect(store.notificationsVersion).toBe(before + 1);
  });

  it('updates the mirror when only createdAt changes', () => {
    const store = new SignalKStore();
    const raise = { state: 'alarm', message: 'Dragging', createdAt: '2026-08-09T00:00:00Z' };
    store.applyFrame(frame({ 'notifications.navigation.anchor': raise }));
    const before = store.notificationsVersion;
    store.applyFrame(
      frame({
        'notifications.navigation.anchor': { ...raise, createdAt: '2026-08-09T01:00:00Z' },
      }),
    );
    expect(store.notificationsVersion).toBe(before + 1);
  });

  it('updates the notification mirror when only its position changes', () => {
    const store = new SignalKStore();
    const value = {
      state: 'emergency',
      message: 'Man overboard',
      id: 'mob-1',
      position: { latitude: 1, longitude: 2 },
    };
    store.applyFrame(frame({ 'notifications.mob.mob-1': value }));
    const before = store.notificationsVersion;
    const moved = { ...value, position: { latitude: 3, longitude: 4 } };
    store.applyFrame(frame({ 'notifications.mob.mob-1': moved }));
    expect(store.notificationsVersion).toBe(before + 1);
    expect(store.notifications.get('notifications.mob.mob-1')).toBe(moved);
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

  it('reconciles the mirror against a snapshot, dropping only what the server no longer raises', () => {
    const store = new SignalKStore();
    store.applyFrame(
      frame({
        'notifications.navigation.anchor': { state: 'alarm', message: 'Dragging' },
        'notifications.mob': { state: 'emergency', message: 'MOB' },
      }),
    );
    const before = store.notificationsVersion;
    store.reconcileNotifications(new Set(['notifications.mob']), 2000);
    expect(store.notifications.has('notifications.navigation.anchor')).toBe(false);
    expect(store.notifications.has('notifications.mob')).toBe(true);
    expect(store.notificationsVersion).toBe(before + 1);
    // The reaped notification's raw cell clears too: keyed consumers (the anchor drag grade)
    // read the cell, and leaving it raised would alarm forever beside an empty alert list.
    expect(store.cell('notifications.navigation.anchor').value).toBeNull();
    // A snapshot matching the mirror exactly is a no-op, with no version bump.
    store.reconcileNotifications(new Set(['notifications.mob']), 2000);
    expect(store.notificationsVersion).toBe(before + 1);
    // An empty snapshot (a restarted server) clears the mirror.
    store.reconcileNotifications(new Set(), 2000);
    expect(store.notifications.size).toBe(0);
    expect(store.notificationsVersion).toBe(before + 2);
  });

  it('keeps a notification whose delta arrived after the snapshot was requested', () => {
    const store = new SignalKStore();
    // The snapshot was requested at epoch 900; the raise arrived by delta at epoch 1000. The
    // snapshot cannot know about the newer raise, so reconciling against it must not delete the
    // live alarm, and the raw cell must stay raised for the keyed consumers.
    store.applyFrame(frame({ 'notifications.mob': { state: 'emergency', message: 'MOB' } }));
    store.reconcileNotifications(new Set(), 900);
    expect(store.notifications.has('notifications.mob')).toBe(true);
    expect(store.cell('notifications.mob').value).not.toBeNull();
  });

  it('stamps lastDataEpoch on data frames only, never on connection-only frames', () => {
    const store = new SignalKStore();
    expect(store.lastDataEpoch).toBe(0);
    store.applyFrame({
      self: new Map(),
      connection: { phase: 'open', attempt: 0 },
      epoch: 500,
    });
    expect(store.lastDataEpoch).toBe(0);
    store.applyFrame({
      self: new Map([['navigation.speedOverGround', 5]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
    });
    expect(store.lastDataEpoch).toBe(1000);
    // An AIS-only frame is data too.
    store.applyFrame({
      self: new Map(),
      ais: aisMap({ 'vessels.a': { name: 'A' } }),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2000,
    });
    expect(store.lastDataEpoch).toBe(2000);
    // A rejected older-generation frame must not advance it.
    store.applyFrame({ ...frame({ 'navigation.speedOverGround': 6 }), epoch: 3000, generation: 2 });
    expect(store.lastDataEpoch).toBe(3000);
    store.applyFrame({ ...frame({ 'navigation.speedOverGround': 7 }), epoch: 4000, generation: 1 });
    expect(store.lastDataEpoch).toBe(3000);
  });

  it('restarts the data-stall window when the stream reopens after an outage', () => {
    const store = new SignalKStore();
    store.applyFrame({
      self: new Map([['navigation.speedOverGround', 5]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 1000,
      generation: 1,
    });
    expect(store.lastDataEpoch).toBe(1000);
    // A reopen after a long outage delivers a connection-only frame with a new generation; the
    // stalled badge must get a fresh window instead of firing off the pre-outage epoch.
    store.applyFrame({
      self: new Map(),
      connection: { phase: 'open', attempt: 0 },
      epoch: 90_000,
      generation: 2,
    });
    expect(store.lastDataEpoch).toBe(90_000);
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

  it('bounds the notification mirror, displacing only a less severe entry', () => {
    const store = new SignalKStore();
    const raise = (path: string, state: string, epoch = 1) => {
      store.applyFrame({
        self: new Map([[path, { state, message: state }]]) as SKFrame['self'],
        connection: { phase: 'open', attempt: 0 },
        epoch,
      });
    };
    // A misbehaving producer holding a thousand alerts raised at once.
    for (let i = 0; i < 1_000; i += 1) raise(`notifications.junk.${i}`, 'alert');
    expect(store.notifications.size).toBe(1_000);

    // Another low-grade alert cannot displace an equal one, so the flood stops growing.
    raise('notifications.junk.overflow', 'alert');
    expect(store.notifications.size).toBe(1_000);
    expect(store.notifications.has('notifications.junk.overflow')).toBe(false);

    // A real hazard still gets in, by displacing one of the alerts.
    raise('notifications.mob', 'emergency');
    expect(store.notifications.size).toBe(1_000);
    expect(store.notifications.has('notifications.mob')).toBe(true);
  });

  it('still updates a path it already mirrors when the mirror is full', () => {
    const store = new SignalKStore();
    const raise = (path: string, state: string) => {
      store.applyFrame({
        self: new Map([[path, { state, message: state }]]) as SKFrame['self'],
        connection: { phase: 'open', attempt: 0 },
        epoch: 1,
      });
    };
    for (let i = 0; i < 1_000; i += 1) raise(`notifications.junk.${i}`, 'alert');
    raise('notifications.junk.0', 'emergency');
    expect(notificationState(store.notifications.get('notifications.junk.0'))).toBe('emergency');
  });
});

describe('SignalKStore server staleness and per-source samples', () => {
  const SOG = 'navigation.speedOverGround';
  const POSITION = 'navigation.position';

  interface StaleEntry {
    sourceRef?: string;
    lastValue?: { value: unknown; epoch?: number };
  }

  // One builder for every staleness and sample scenario: self values, per-path sources, stale
  // markers, and a generation, so a test reads as data rather than frame plumbing.
  function buildFrame(
    self: Record<string, unknown>,
    epoch: number,
    options: {
      sources?: Record<string, { label?: string; ref?: string }>;
      stales?: Record<string, StaleEntry>;
      generation?: number;
    } = {},
  ): SKFrame {
    const frame: SKFrame = {
      self: new Map(Object.entries(self)) as SKFrame['self'],
      connection: { phase: 'open', attempt: 0 },
      epoch,
    };
    if (options.sources) frame.selfSources = new Map(Object.entries(options.sources));
    if (options.stales) frame.selfStales = new Map(Object.entries(options.stales));
    if (options.generation !== undefined) frame.generation = options.generation;
    return frame;
  }

  it('sets the record while retaining the value, epoch, and source', () => {
    const store = new SignalKStore();
    store.applyFrame(
      buildFrame({ [SOG]: 5.5 }, 1000, { sources: { [SOG]: { label: 'gps0', ref: 'gps0.GP' } } }),
    );
    store.applyFrame(buildFrame({}, 61_000, { stales: { [SOG]: { sourceRef: 'gps0.GP' } } }));
    const cell = store.cell(SOG);
    expect(cell.serverStale).toEqual({ sourceRef: 'gps0.GP', lastValueEpoch: 1000 });
    expect(cell.value).toBe(5.5);
    expect(cell.epoch).toBe(1000);
    expect(cell.source).toEqual({ label: 'gps0', ref: 'gps0.GP' });
  });

  it('clears the record on any later self value, null included', () => {
    const store = new SignalKStore();
    store.applyFrame(buildFrame({ [SOG]: 5.5 }, 1000));
    store.applyFrame(buildFrame({}, 61_000, { stales: { [SOG]: {} } }));
    expect(store.cell(SOG).serverStale).toBeDefined();
    // A resumed sounder reporting no bottom publishes null; the server accepted it, so the path
    // is live again.
    store.applyFrame(buildFrame({ [SOG]: null }, 62_000));
    expect(store.cell(SOG).serverStale).toBeUndefined();
    expect(store.cell(SOG).value).toBeNull();
  });

  it('ignores a declaration for a source that is not the cell current one', () => {
    // Dual-GPS: unit A dies, unit B keeps publishing. A's timeout must not mark the path.
    const store = new SignalKStore();
    store.applyFrame(
      buildFrame({ [POSITION]: { latitude: 1, longitude: 2 } }, 1000, {
        sources: { [POSITION]: { label: 'gps-b', ref: 'gps-b.GP' } },
      }),
    );
    store.applyFrame(buildFrame({}, 61_000, { stales: { [POSITION]: { sourceRef: 'gps-a.GP' } } }));
    expect(store.cell(POSITION).serverStale).toBeUndefined();
  });

  it('applies a declaration when the cell has no source ref to compare', () => {
    const store = new SignalKStore();
    store.applyFrame(buildFrame({ [SOG]: 5.5 }, 1000));
    store.applyFrame(buildFrame({}, 61_000, { stales: { [SOG]: { sourceRef: 'gps0.GP' } } }));
    expect(store.cell(SOG).serverStale?.sourceRef).toBe('gps0.GP');
  });

  it('applies both a value and a marker arriving in one frame, value first', () => {
    const store = new SignalKStore();
    store.applyFrame(buildFrame({ [SOG]: 4.2 }, 1000, { stales: { [SOG]: {} } }));
    const cell = store.cell(SOG);
    expect(cell.value).toBe(4.2);
    expect(cell.epoch).toBe(1000);
    expect(cell.serverStale).toBeDefined();
  });

  it('seeds a never-streamed cell from the declaration lastValue', () => {
    const store = new SignalKStore();
    const fix = { latitude: 60.1, longitude: 24.9 };
    store.applyFrame(
      buildFrame({}, 61_000, {
        stales: {
          [POSITION]: { lastValue: { value: fix, epoch: 55_000 } },
          [SOG]: { lastValue: { value: 5.5, epoch: 55_000 } },
        },
      }),
    );
    const position = store.cell(POSITION);
    expect(position.value).toEqual(fix);
    expect(position.epoch).toBe(0);
    expect(position.streamed).toBe(false);
    expect(position.serverStale?.lastValueEpoch).toBe(55_000);
    const sog = store.cell(SOG);
    expect(sog.value).toBe(5.5);
    expect(sog.serverStale?.lastValueEpoch).toBe(55_000);
  });

  it('prefers the receipt epoch over the marker epoch once the cell has streamed', () => {
    const store = new SignalKStore();
    store.applyFrame(buildFrame({ [SOG]: 5.5 }, 40_000));
    store.applyFrame(
      buildFrame({}, 61_000, { stales: { [SOG]: { lastValue: { value: 5.5, epoch: 39_000 } } } }),
    );
    expect(store.cell(SOG).serverStale?.lastValueEpoch).toBe(40_000);
  });

  it('latches across a reconnect and skips the write on an equivalent replay', () => {
    const store = new SignalKStore();
    store.applyFrame(buildFrame({ [SOG]: 5.5 }, 1000, { generation: 1 }));
    store.applyFrame(buildFrame({}, 61_000, { stales: { [SOG]: {} }, generation: 1 }));
    const record = store.cell(SOG).serverStale;
    expect(record).toBeDefined();
    // The socket reopens; the cache replays an equivalent declaration. The record must survive
    // the generation bump AND keep its identity, so consumers are not invalidated for nothing.
    store.applyFrame(buildFrame({}, 70_000, { stales: { [SOG]: {} }, generation: 2 }));
    expect(store.cell(SOG).serverStale).toBe(record);
    // Only a real value clears it.
    store.applyFrame(buildFrame({ [SOG]: 5.6 }, 71_000, { generation: 2 }));
    expect(store.cell(SOG).serverStale).toBeUndefined();
  });

  it('retires only the declared source sample when another source keeps the path live', () => {
    const store = new SignalKStore();
    store.traceSources([POSITION]);
    store.applyFrame(
      buildFrame({ [POSITION]: { latitude: 1, longitude: 2 } }, 1000, {
        sources: { [POSITION]: { label: 'gps-a', ref: 'gps-a.GP' } },
      }),
    );
    store.applyFrame(
      buildFrame({ [POSITION]: { latitude: 1.1, longitude: 2 } }, 2000, {
        sources: { [POSITION]: { label: 'gps-b', ref: 'gps-b.GP' } },
      }),
    );
    const cell = store.cell(POSITION);
    expect(cell.sourceSamples?.size).toBe(2);
    const revisionBefore = cell.sourceSamplesRevision;
    store.applyFrame(buildFrame({}, 61_000, { stales: { [POSITION]: { sourceRef: 'gps-a.GP' } } }));
    expect(cell.serverStale).toBeUndefined();
    expect(cell.sourceSamples?.has('gps-a.GP')).toBe(false);
    expect(cell.sourceSamples?.has('gps-b.GP')).toBe(true);
    expect(cell.sourceSamplesRevision).toBe(revisionBefore + 1);
  });

  it('does not advance lastDataEpoch or touch sourceTrace on a stale-only frame', () => {
    const store = new SignalKStore();
    store.traceSources([SOG]);
    store.applyFrame(buildFrame({ [SOG]: 5.5 }, 1000, { sources: { [SOG]: { label: 'gps0' } } }));
    expect(store.lastDataEpoch).toBe(1000);
    const traceBefore = store.cell(SOG).sourceTrace;
    store.applyFrame(buildFrame({}, 61_000, { stales: { [SOG]: { sourceRef: 'gps0.GP' } } }));
    expect(store.lastDataEpoch).toBe(1000);
    expect(store.cell(SOG).sourceTrace).toBe(traceBefore);
  });

  it('keys samples by ref so two devices on one bus stay distinct', () => {
    const store = new SignalKStore();
    store.traceSources([SOG]);
    store.applyFrame(
      buildFrame({ [SOG]: 5.1 }, 1000, {
        sources: { [SOG]: { label: 'n2kFromFile', ref: 'n2kFromFile.160' } },
      }),
    );
    store.applyFrame(
      buildFrame({ [SOG]: 5.4 }, 2000, {
        sources: { [SOG]: { label: 'n2kFromFile', ref: 'n2kFromFile.161' } },
      }),
    );
    const samples = store.cell(SOG).sourceSamples;
    expect(samples?.size).toBe(2);
    expect(samples?.get('n2kFromFile.160')?.value).toBe(5.1);
    expect(samples?.get('n2kFromFile.161')?.value).toBe(5.4);
  });

  it('updates a known source in place without bumping the revision', () => {
    const store = new SignalKStore();
    store.traceSources([SOG]);
    store.applyFrame(
      buildFrame({ [SOG]: 5.1 }, 1000, { sources: { [SOG]: { label: 'gps0', ref: 'gps0.GP' } } }),
    );
    const cell = store.cell(SOG);
    const revision = cell.sourceSamplesRevision;
    store.applyFrame(
      buildFrame({ [SOG]: 5.2 }, 2000, { sources: { [SOG]: { label: 'gps0', ref: 'gps0.GP' } } }),
    );
    expect(cell.sourceSamples?.get('gps0.GP')?.value).toBe(5.2);
    expect(cell.sourceSamples?.get('gps0.GP')?.epoch).toBe(2000);
    expect(cell.sourceSamplesRevision).toBe(revision);
  });

  it('caps samples per path by evicting the least recently heard', () => {
    const store = new SignalKStore();
    store.traceSources([SOG]);
    for (let index = 0; index < 5; index += 1) {
      store.applyFrame(
        buildFrame({ [SOG]: index }, 1000 + index, {
          sources: { [SOG]: { label: `bus${index}`, ref: `bus${index}.1` } },
        }),
      );
    }
    const samples = store.cell(SOG).sourceSamples;
    expect(samples?.size).toBe(4);
    expect(samples?.has('bus0.1')).toBe(false);
    expect(samples?.has('bus4.1')).toBe(true);
  });

  it('records nothing for an untraced path', () => {
    const store = new SignalKStore();
    store.applyFrame(
      buildFrame({ [SOG]: 5.1 }, 1000, { sources: { [SOG]: { label: 'gps0', ref: 'gps0.GP' } } }),
    );
    expect(store.cell(SOG).sourceSamples).toBeUndefined();
  });

  it('falls back to the label as the key for a source-object-only producer', () => {
    const store = new SignalKStore();
    store.traceSources([SOG]);
    store.applyFrame(buildFrame({ [SOG]: 5.1 }, 1000, { sources: { [SOG]: { label: 'gps0' } } }));
    expect(store.cell(SOG).sourceSamples?.get('gps0')?.value).toBe(5.1);
  });

  it('clears samples on a reconnect generation bump', () => {
    const store = new SignalKStore();
    store.traceSources([SOG]);
    store.applyFrame(
      buildFrame({ [SOG]: 5.1 }, 1000, {
        sources: { [SOG]: { label: 'gps0', ref: 'gps0.GP' } },
        generation: 1,
      }),
    );
    const cell = store.cell(SOG);
    const revision = cell.sourceSamplesRevision;
    store.applyFrame(buildFrame({}, 5000, { generation: 2 }));
    expect(cell.sourceSamples?.size).toBe(0);
    expect(cell.sourceSamplesRevision).toBe(revision + 1);
  });
});

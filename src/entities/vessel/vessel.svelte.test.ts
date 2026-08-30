import { describe, expect, it } from 'vitest';
import type { SKFrame } from '$shared/signalk';
import { SignalKStore, SK_PATHS } from '$shared/signalk';
import { DEPTH_SOURCE_LABELS, DEPTH_SOURCE_TITLES, OwnVessel } from './vessel.svelte';

function frame(self: Record<string, unknown>, epoch = 1000): SKFrame {
  return {
    self: new Map(Object.entries(self)) as SKFrame['self'],
    connection: { phase: 'open', attempt: 0 },
    epoch,
  };
}

describe('OwnVessel', () => {
  it('exposes speed over ground in m/s (SI)', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(frame({ 'navigation.speedOverGround': 3.5 }));
    expect(vessel.sogMps).toBe(3.5);
  });

  it('exposes apparent wind in m/s and outside pressure in Pascals (SI)', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(
      frame({
        'environment.wind.speedApparent': 7.2,
        'environment.outside.pressure': 101325,
      }),
    );
    expect(vessel.windSpeedApparentMps).toBe(7.2);
    expect(vessel.outsidePressurePa).toBe(101325);
  });

  it('exposes depth in meters (SI) from the transducer when it is the only source', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(frame({ 'environment.depth.belowTransducer': 12.4 }));
    expect(vessel.safetyDepth.meters).toBe(12.4);
    expect(vessel.safetyDepth.source).toBe('transducer');
  });

  it('exposes course over ground and heading in radians (SI)', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(
      frame({ 'navigation.courseOverGroundTrue': Math.PI, 'navigation.headingTrue': 1 }),
    );
    expect(vessel.cogRad).toBe(Math.PI);
    expect(vessel.headingRad).toBe(1);
  });

  it('returns the position object unchanged (already degrees)', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(frame({ 'navigation.position': { latitude: 36.8, longitude: -121.7 } }));
    expect(vessel.position).toEqual({ latitude: 36.8, longitude: -121.7 });
  });

  it('returns undefined readouts before any data arrives', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    expect(vessel.sogMps).toBeUndefined();
    expect(vessel.position).toBeUndefined();
  });

  it('reports no staleness before any fix and while a clock is absent', () => {
    const store = new SignalKStore();
    // No clock wired: staleness is never reported, the pre-clock behavior.
    expect(new OwnVessel(store).positionStale).toBe(false);
    // With a clock but no fix yet, the position is absent, not stale.
    const clock = $state({ now: 1000 });
    expect(new OwnVessel(store, clock).positionStale).toBe(false);
  });

  it('flags the fix stale once it ages past the threshold, fresh again on a new fix', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 1000 });
    const vessel = new OwnVessel(store, clock);
    // The frame stamps the position cell at epoch 1000.
    store.applyFrame(frame({ 'navigation.position': { latitude: 1, longitude: 2 } }));
    clock.now = 1000 + 5_000;
    expect(vessel.positionStale).toBe(false);
    clock.now = 1000 + 20_000;
    expect(vessel.positionStale).toBe(true);
    // A fresh fix at the current clock clears the staleness.
    clock.now = 1000 + 21_000;
    store.applyFrame({
      self: new Map([['navigation.position', { latitude: 1, longitude: 2 }]]) as SKFrame['self'],
      connection: { phase: 'open', attempt: 0 },
      epoch: clock.now,
    });
    expect(vessel.positionStale).toBe(false);
  });

  it('reports stale on a server declaration, with no clock wired and inside the client window', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(frame({ 'navigation.position': { latitude: 1, longitude: 2 } }));
    expect(vessel.positionStale).toBe(false);
    store.applyFrame({
      self: new Map(),
      selfStales: new Map([['navigation.position', {}]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2000,
    });
    // A declaration is a fact, not a window: it holds with no clock and a fresh epoch.
    expect(vessel.positionStale).toBe(true);
    expect(vessel.position).toEqual({ latitude: 1, longitude: 2 });
    // A real fix clears it.
    store.applyFrame(frame({ 'navigation.position': { latitude: 1.1, longitude: 2 } }, 3000));
    expect(vessel.positionStale).toBe(false);
  });

  it('ages and counts a fix seeded from a staleness declaration lastValue', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    expect(vessel.positionReceived).toBe(false);
    expect(vessel.positionEpochMs).toBeUndefined();
    // A late subscriber: the cache replays only the staleness shape, never a live fix.
    store.applyFrame({
      self: new Map(),
      selfStales: new Map([
        [
          'navigation.position',
          {
            lastValue: { value: { latitude: 1, longitude: 2 }, epoch: 55_000 },
          },
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 61_000,
    });
    expect(vessel.position).toEqual({ latitude: 1, longitude: 2 });
    expect(vessel.positionStale).toBe(true);
    expect(vessel.positionReceived).toBe(true);
    expect(vessel.positionEpochMs).toBe(55_000);
  });

  it('marks the safety depth stale on a server declaration, so the shallow watch pauses', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(frame({ 'environment.depth.belowTransducer': 3.2 }));
    expect(vessel.safetyDepth.stale).toBe(false);
    store.applyFrame({
      self: new Map(),
      selfStales: new Map([['environment.depth.belowTransducer', {}]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 2000,
    });
    expect(vessel.safetyDepth.stale).toBe(true);
    // The retained reading survives: the monitor reports stale, never a phantom blank.
    expect(vessel.safetyDepth.meters).toBe(3.2);
  });

  it('grades each safety-relevant path independently', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 1000 });
    const vessel = new OwnVessel(store, clock);
    store.applyFrame(
      frame({
        'navigation.speedOverGround': 3,
        'navigation.courseOverGroundTrue': 1,
        'navigation.headingTrue': 2,
        'environment.depth.belowTransducer': 8,
        'environment.wind.speedApparent': 5,
        'environment.outside.pressure': 101325,
      }),
    );
    clock.now = 20_000;
    expect(vessel.sogStale).toBe(true);
    expect(vessel.cogStale).toBe(true);
    expect(vessel.headingStale).toBe(true);
    expect(vessel.safetyDepth.stale).toBe(true);
    expect(vessel.windStale).toBe(true);
    expect(vessel.pressureStale).toBe(true);

    store.applyFrame({
      self: new Map([['environment.depth.belowTransducer', 7]]) as SKFrame['self'],
      connection: { phase: 'open', attempt: 0 },
      epoch: clock.now,
    });
    expect(vessel.safetyDepth.stale).toBe(false);
    expect(vessel.headingStale).toBe(true);
    expect(vessel.windStale).toBe(true);
    expect(vessel.pressureStale).toBe(true);
  });

  it('marks old-generation telemetry stale immediately after reconnect', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame({
      ...frame({ 'navigation.position': { latitude: 1, longitude: 2 } }),
      generation: 1,
    });
    expect(vessel.positionStale).toBe(false);
    store.applyFrame({ ...frame({}), generation: 2 });
    expect(vessel.positionStale).toBe(true);
  });

  it('pre-creates its cells at construction so reactive reads track them', () => {
    // The store creates a cell lazily on first access. If that first access were a
    // reactive template read, the freshly created $state source would not be tracked
    // and later updates would not re-render (this caused the readouts to stay blank
    // with live data flowing). Constructing the vessel must create the cells up front.
    const store = new SignalKStore();
    const created: string[] = [];
    const realCell = store.cell.bind(store);
    store.cell = (path: string) => {
      created.push(path);
      return realCell(path);
    };
    new OwnVessel(store);
    expect(created).toEqual([
      'navigation.position',
      'navigation.speedOverGround',
      'navigation.courseOverGroundTrue',
      'navigation.headingTrue',
      'environment.depth.belowTransducer',
      'environment.depth.belowKeel',
      'environment.depth.belowSurface',
      'environment.wind.speedApparent',
      'environment.outside.pressure',
      'design.draft',
      'design.airHeight',
      'design.length',
      'design.beam',
    ]);
  });
});

describe('OwnVessel depth resolution', () => {
  it('labels and titles every depth source', () => {
    expect(DEPTH_SOURCE_LABELS).toEqual({
      keel: 'Keel',
      surface: 'Surface',
      transducer: 'Xducer',
    });
    expect(DEPTH_SOURCE_TITLES).toEqual({
      keel: 'Depth below the keel',
      surface: 'Depth below the surface',
      transducer: 'Depth below the transducer',
    });
  });

  it('prefers the keel, then the transducer, then the surface for the safety depth', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(
      frame({
        [SK_PATHS.depthBelowTransducer]: 8,
        [SK_PATHS.depthBelowSurface]: 9,
        [SK_PATHS.depthBelowKeel]: 7,
      }),
    );
    expect(vessel.safetyDepth).toEqual({
      meters: 7,
      source: 'keel',
      path: SK_PATHS.depthBelowKeel,
      stale: false,
    });
  });

  it('keeps the safety depth on the transducer when a positive-offset sounder adds the surface', () => {
    // A positive transducer offset publishes belowSurface alongside belowTransducer and never
    // belowKeel. Surface always reads deeper by the offset, so alarming on it would fire late:
    // the transducer must win this pairing.
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(
      frame({
        [SK_PATHS.depthBelowTransducer]: 8,
        [SK_PATHS.depthBelowSurface]: 8.6,
      }),
    );
    expect(vessel.safetyDepth).toEqual({
      meters: 8,
      source: 'transducer',
      path: SK_PATHS.depthBelowTransducer,
      stale: false,
    });
  });

  it('resolves the safety depth on a corrected-only boat that never publishes the transducer', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(frame({ [SK_PATHS.depthBelowSurface]: 9 }));
    expect(vessel.safetyDepth).toEqual({
      meters: 9,
      source: 'surface',
      path: SK_PATHS.depthBelowSurface,
      stale: false,
    });
  });

  it('reports no depth source before any sounder publishes, graded on the transducer path', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    expect(vessel.safetyDepth).toEqual({
      meters: undefined,
      source: undefined,
      path: SK_PATHS.depthBelowTransducer,
      stale: false,
    });
  });

  it('keeps a stale preferred source rather than falling through to a fresh lesser one', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 1000 });
    const vessel = new OwnVessel(store, clock);
    store.applyFrame(frame({ [SK_PATHS.depthBelowKeel]: 7 }));
    clock.now = 20_000;
    store.applyFrame(frame({ [SK_PATHS.depthBelowTransducer]: 8 }, clock.now));
    expect(vessel.safetyDepth).toEqual({
      meters: 7,
      source: 'keel',
      path: SK_PATHS.depthBelowKeel,
      stale: true,
    });
  });

  it('takes staleness from the winning path, not from a stale lesser source', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 1000 });
    const vessel = new OwnVessel(store, clock);
    store.applyFrame(frame({ [SK_PATHS.depthBelowTransducer]: 8 }));
    clock.now = 20_000;
    store.applyFrame(frame({ [SK_PATHS.depthBelowKeel]: 7 }, clock.now));
    expect(vessel.safetyDepth.source).toBe('keel');
    expect(vessel.safetyDepth.stale).toBe(false);
  });

  it('never reads the keel for the anchor depth', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(
      frame({
        [SK_PATHS.depthBelowTransducer]: 8,
        [SK_PATHS.depthBelowSurface]: 9,
        [SK_PATHS.depthBelowKeel]: 7,
      }),
    );
    expect(vessel.anchorDepth).toEqual({
      meters: 9,
      source: 'surface',
      path: SK_PATHS.depthBelowSurface,
      stale: false,
    });

    const keelOnly = new SignalKStore();
    const keelVessel = new OwnVessel(keelOnly);
    keelOnly.applyFrame(
      frame({ [SK_PATHS.depthBelowTransducer]: 8, [SK_PATHS.depthBelowKeel]: 7 }),
    );
    expect(keelVessel.anchorDepth.meters).toBe(8);
    expect(keelVessel.anchorDepth.source).toBe('transducer');
  });

  it('prefers the transducer for the trend source', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(
      frame({
        [SK_PATHS.depthBelowTransducer]: 8,
        [SK_PATHS.depthBelowSurface]: 9,
        [SK_PATHS.depthBelowKeel]: 7,
      }),
    );
    expect(vessel.trendDepth.source).toBe('transducer');
    expect(vessel.trendDepth.meters).toBe(8);
  });

  it('latches the trend source at the first read so a later source cannot step the history', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(frame({ [SK_PATHS.depthBelowSurface]: 9 }));
    expect(vessel.trendDepth.source).toBe('surface');

    store.applyFrame(
      frame({
        [SK_PATHS.depthBelowSurface]: 9.5,
        [SK_PATHS.depthBelowKeel]: 7,
        [SK_PATHS.depthBelowTransducer]: 8,
      }),
    );
    expect(vessel.trendDepth).toEqual({
      meters: 9.5,
      source: 'surface',
      path: SK_PATHS.depthBelowSurface,
      stale: false,
    });
  });

  it('does not latch the trend source while no depth has been published', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    expect(vessel.trendDepth.source).toBeUndefined();
    store.applyFrame(frame({ [SK_PATHS.depthBelowKeel]: 7 }));
    expect(vessel.trendDepth.source).toBe('keel');
  });

  it('exposes the declared dimensions in meters from the spec object values', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(
      frame({
        [SK_PATHS.designDraft]: { maximum: 2.1, minimum: 1.2 },
        [SK_PATHS.designAirHeight]: 18.5,
        [SK_PATHS.designLength]: { overall: 12.8, hull: 12.1 },
        [SK_PATHS.designBeam]: 4.2,
      }),
    );
    expect(vessel.draftMeters).toBe(2.1);
    expect(vessel.airHeightMeters).toBe(18.5);
    expect(vessel.lengthMeters).toBe(12.8);
    expect(vessel.beamMeters).toBe(4.2);
  });

  it('accepts a bare-number draft and length as the provider degrade', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(frame({ [SK_PATHS.designDraft]: 1.9, [SK_PATHS.designLength]: 11 }));
    expect(vessel.draftMeters).toBe(1.9);
    expect(vessel.lengthMeters).toBe(11);
  });

  it('rejects malformed or implausible dimension declarations', () => {
    const store = new SignalKStore();
    const vessel = new OwnVessel(store);
    store.applyFrame(
      frame({
        [SK_PATHS.designDraft]: { maximum: -1 },
        [SK_PATHS.designAirHeight]: 0,
        [SK_PATHS.designLength]: { overall: 5_000 },
        [SK_PATHS.designBeam]: 'wide',
      }),
    );
    expect(vessel.draftMeters).toBeUndefined();
    expect(vessel.airHeightMeters).toBeUndefined();
    expect(vessel.lengthMeters).toBeUndefined();
    expect(vessel.beamMeters).toBeUndefined();
  });

  it('reports no dimensions before any declaration arrives', () => {
    const vessel = new OwnVessel(new SignalKStore());
    expect(vessel.draftMeters).toBeUndefined();
    expect(vessel.airHeightMeters).toBeUndefined();
    expect(vessel.lengthMeters).toBeUndefined();
    expect(vessel.beamMeters).toBeUndefined();
  });
});

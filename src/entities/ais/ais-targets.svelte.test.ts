import { describe, expect, it } from 'vitest';
import type { SKFrame } from '$shared/signalk';
import { SignalKStore } from '$shared/signalk';
import { AisTargets, parseIso8601DurationSeconds } from './ais-targets.svelte';

function frame(ais: Record<string, Record<string, unknown>>, epoch = Date.now()): SKFrame {
  return {
    self: new Map(),
    ais: new Map(Object.entries(ais).map(([ctx, vals]) => [ctx, new Map(Object.entries(vals))])),
    connection: { phase: 'open', attempt: 0 },
    epoch,
  };
}

describe('AisTargets', () => {
  it('lists targets with SI values straight from the store', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(
      frame({
        'vessels.urn:mrn:imo:mmsi:123': {
          'navigation.position': { latitude: 36, longitude: -121 },
          'navigation.courseOverGroundTrue': Math.PI,
          'navigation.speedOverGround': 1,
          name: 'OTHER',
        },
      }),
    );
    const list = ais.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('vessels.urn:mrn:imo:mmsi:123');
    expect(list[0].name).toBe('OTHER');
    expect(list[0].position).toEqual({ latitude: 36, longitude: -121 });
    expect(list[0].cogRad).toBe(Math.PI);
    expect(list[0].sogMps).toBe(1);
  });

  it('skips targets without a position', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(frame({ 'vessels.x': { name: 'no pos' } }));
    expect(ais.list()).toHaveLength(0);
  });

  it('resolves only a currently visible target by id', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(
      frame({
        'vessels.visible': {
          'navigation.position': { latitude: 36, longitude: -121 },
        },
        'vessels.no-position': { name: 'No fix' },
      }),
    );

    expect(ais.find('vessels.visible')?.position).toEqual({ latitude: 36, longitude: -121 });
    expect(ais.find('vessels.no-position')).toBeUndefined();
    expect(ais.find('vessels.missing')).toBeUndefined();
  });

  // find() indexes the memoized list, so it must hand back the very object the list holds and it
  // must follow a rebuild rather than answer from a stale index.
  it('returns the listed view object and tracks it across a rebuild', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(
      frame({ 'vessels.a': { 'navigation.position': { latitude: 36, longitude: -121 } } }),
    );
    expect(ais.find('vessels.a')).toBe(ais.list()[0]);

    store.applyFrame(
      frame({
        'vessels.a': { 'navigation.position': { latitude: 37, longitude: -121 } },
        'vessels.b': { 'navigation.position': { latitude: 38, longitude: -121 } },
      }),
    );
    expect(ais.find('vessels.a')?.position.latitude).toBe(37);
    expect(ais.find('vessels.b')).toBe(ais.list()[1]);
  });

  it('exposes closestApproach as cpa and tcpa from a raw-number timeTo', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(
      frame({
        'vessels.y': {
          'navigation.position': { latitude: 0, longitude: 0 },
          'navigation.closestApproach': { distance: 926, timeTo: 600 },
        },
      }),
    );
    const target = ais.list()[0];
    expect(target.cpaMeters).toBe(926);
    expect(target.tcpaSeconds).toBe(600);
  });

  it('parses a spec-conformant ISO-8601 duration timeTo to seconds', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(
      frame({
        'vessels.z': {
          'navigation.position': { latitude: 0, longitude: 0 },
          'navigation.closestApproach': { distance: 926, timeTo: 'PT1M30S' },
        },
      }),
    );
    const target = ais.list()[0];
    expect(target.cpaMeters).toBe(926);
    expect(target.tcpaSeconds).toBe(90);
  });

  it('reads navigation.state as navigationState, absent when never reported', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(
      frame({
        'vessels.anchored': {
          'navigation.position': { latitude: 0, longitude: 0 },
          'navigation.state': 'anchored',
        },
        'vessels.silent': {
          'navigation.position': { latitude: 1, longitude: 1 },
        },
      }),
    );
    const list = ais.list();
    expect(list.find((t) => t.id === 'vessels.anchored')?.navigationState).toBe('anchored');
    expect(list.find((t) => t.id === 'vessels.silent')?.navigationState).toBeUndefined();
  });

  it('expires CPA and TCPA together while retaining the target position', () => {
    let now = 1000;
    const store = new SignalKStore();
    const ais = new AisTargets(store, () => now);
    store.applyFrame(
      frame(
        {
          'vessels.risk': {
            'navigation.position': { latitude: 0, longitude: 0 },
            'navigation.closestApproach': { distance: 100, timeTo: 60 },
          },
        },
        now,
      ),
    );
    expect(ais.list()[0]).toMatchObject({ cpaMeters: 100, tcpaSeconds: 60 });
    now += 30_001;
    expect(ais.list()).toHaveLength(1);
    expect(ais.list()[0].cpaMeters).toBeUndefined();
    expect(ais.list()[0].tcpaSeconds).toBeUndefined();
  });

  it('expires target motion before its slow-reporting position', () => {
    let now = 1000;
    const store = new SignalKStore();
    const ais = new AisTargets(store, () => now);
    store.applyFrame(
      frame(
        {
          'vessels.motion': {
            'navigation.position': { latitude: 0, longitude: 0 },
            'navigation.courseOverGroundTrue': 1,
            'navigation.speedOverGround': 4,
          },
        },
        now,
      ),
    );
    expect(ais.list()[0]).toMatchObject({ cogRad: 1, sogMps: 4 });
    now += 30_001;
    expect(ais.list()[0]).toMatchObject({ cogRad: 1, sogMps: 4 });
    now += 30_000;
    expect(ais.list()).toHaveLength(1);
    expect(ais.list()[0].cogRad).toBeUndefined();
    expect(ais.list()[0].sogMps).toBeUndefined();
  });

  it('hides telemetry from a previous connection generation', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame({
      ...frame({ 'vessels.old': { 'navigation.position': { latitude: 0, longitude: 0 } } }),
      generation: 1,
    });
    expect(ais.list()).toHaveLength(1);
    store.applyFrame({ ...frame({}), generation: 2 });
    expect(ais.list()).toHaveLength(0);
  });

  it('does not keep an old position alive when an unrelated target field updates', () => {
    let now = 1000;
    const store = new SignalKStore();
    const ais = new AisTargets(store, () => now);
    store.applyFrame(
      frame({ 'vessels.old-fix': { 'navigation.position': { latitude: 0, longitude: 0 } } }, now),
    );
    expect(ais.list()).toHaveLength(1);
    now += 7 * 60_000 + 1;
    store.applyFrame(frame({ 'vessels.old-fix': { name: 'Still transmitting' } }, now));
    expect(ais.list()).toHaveLength(0);
  });
});

describe('AisTargets static and voyage data', () => {
  it('surfaces class, dimensions, destination, and a parsed ETA', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(
      frame({
        'vessels.urn:mrn:imo:mmsi:123': {
          'navigation.position': { latitude: 36, longitude: -121 },
          'sensors.ais.class': 'A',
          'design.length': { overall: 294 },
          'design.beam': 32.2,
          'navigation.destination.commonName': 'ROTTERDAM',
          'navigation.destination.eta': '2026-09-02T06:00:00.000Z',
        },
      }),
    );
    const target = ais.list()[0];
    expect(target.kind).toBe('vessel');
    expect(target.aisClass).toBe('A');
    expect(target.lengthMeters).toBe(294);
    expect(target.beamMeters).toBe(32.2);
    expect(target.destination).toBe('ROTTERDAM');
    expect(target.destinationEtaMs).toBe(Date.parse('2026-09-02T06:00:00.000Z'));
  });

  it('rejects malformed static fields rather than surfacing them', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(
      frame({
        'vessels.bad': {
          'navigation.position': { latitude: 0, longitude: 0 },
          // 'C' is not a transponder grade, a bare number is not the length shape, a negative
          // beam is garbage, the destination is oversized, and the ETA is unparseable.
          'sensors.ais.class': 'C',
          'design.length': 294,
          'design.beam': -3,
          'navigation.destination.commonName': 'X'.repeat(65),
          'navigation.destination.eta': 'tomorrow-ish',
        },
      }),
    );
    const target = ais.list()[0];
    expect(target.aisClass).toBeUndefined();
    expect(target.lengthMeters).toBeUndefined();
    expect(target.beamMeters).toBeUndefined();
    expect(target.destination).toBeUndefined();
    expect(target.destinationEtaMs).toBeUndefined();
  });
});

describe('AisTargets non-vessel kinds', () => {
  it('tags atons and sar by context and keeps list() vessels only', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(
      frame({
        'vessels.a': { 'navigation.position': { latitude: 0, longitude: 0 } },
        'atons.urn:mrn:imo:mmsi:993672085': {
          'navigation.position': { latitude: 1, longitude: 1 },
          name: 'PT MONTARA LIGHT',
        },
        'sar.urn:mrn:imo:mmsi:111234567': {
          'navigation.position': { latitude: 2, longitude: 2 },
          'navigation.speedOverGround': 51,
        },
      }),
    );
    const all = ais.all();
    expect(all).toHaveLength(3);
    expect(all.map((t) => t.kind).sort()).toEqual(['aton', 'sar', 'vessel']);
    // The vessels-only view feeds collision assessment: an aid or aircraft must never be graded
    // as an own-motion contact.
    const vessels = ais.list();
    expect(vessels).toHaveLength(1);
    expect(vessels[0].kind).toBe('vessel');
    expect(ais.find('atons.urn:mrn:imo:mmsi:993672085')?.name).toBe('PT MONTARA LIGHT');
  });

  it('hands list() the very same array as all() when only vessels exist', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(
      frame({ 'vessels.a': { 'navigation.position': { latitude: 0, longitude: 0 } } }),
    );
    expect(ais.list()).toBe(ais.all());
  });

  it('reads the aton type name, virtual flag, and off-position flag', () => {
    const store = new SignalKStore();
    const ais = new AisTargets(store);
    store.applyFrame(
      frame({
        'atons.virtual': {
          'navigation.position': { latitude: 1, longitude: 1 },
          atonType: { id: 28, name: 'Floating AtoN: isolated danger' },
          virtual: true,
          offPosition: false,
          'design.length': { overall: 5 },
        },
        'atons.adrift': {
          'navigation.position': { latitude: 2, longitude: 2 },
          offPosition: true,
        },
      }),
    );
    const virtual = ais.find('atons.virtual');
    expect(virtual?.kind).toBe('aton');
    expect(virtual?.atonType).toBe('Floating AtoN: isolated danger');
    expect(virtual?.virtual).toBe(true);
    expect(virtual?.offPosition).toBeUndefined();
    expect(virtual?.lengthMeters).toBe(5);
    expect(ais.find('atons.adrift')?.offPosition).toBe(true);
    expect(ais.find('atons.adrift')?.virtual).toBeUndefined();
  });

  it('prunes a silent aton through the shared whole-target TTL', () => {
    let now = 1_000;
    const store = new SignalKStore();
    const ais = new AisTargets(store, () => now);
    store.applyFrame(
      frame({ 'atons.gone': { 'navigation.position': { latitude: 1, longitude: 1 } } }, now),
    );
    expect(ais.all()).toHaveLength(1);
    now += 60_000;
    store.pruneAis(now, 30_000);
    expect(ais.all()).toHaveLength(0);
  });
});

describe('parseIso8601DurationSeconds', () => {
  it('parses ISO-8601 durations to signed seconds', () => {
    expect(parseIso8601DurationSeconds('PT1M30S')).toBe(90);
    expect(parseIso8601DurationSeconds('PT90S')).toBe(90);
    expect(parseIso8601DurationSeconds('PT1H')).toBe(3600);
    expect(parseIso8601DurationSeconds('-PT30S')).toBe(-30);
  });

  it('passes a bare number through as seconds', () => {
    expect(parseIso8601DurationSeconds(600)).toBe(600);
    expect(parseIso8601DurationSeconds(0)).toBe(0);
  });

  it('returns undefined for a malformed or missing value', () => {
    expect(parseIso8601DurationSeconds('not a duration')).toBeUndefined();
    expect(parseIso8601DurationSeconds('PT')).toBeUndefined();
    expect(parseIso8601DurationSeconds('P')).toBeUndefined();
    expect(parseIso8601DurationSeconds(undefined)).toBeUndefined();
    expect(parseIso8601DurationSeconds(Number.NaN)).toBeUndefined();
  });
});

describe('AisTargets view memoization', () => {
  const at = (latitude: number) => ({ 'navigation.position': { latitude, longitude: -121 } });
  // A controllable clock: the freshness windows are compared against it, so a fixed epoch keeps the
  // memo behavior, not staleness, as the only thing under test.
  const clocked = (store: SignalKStore, now: () => number) => new AisTargets(store, now);

  it('keeps an unchanged vessel object identity across a rebuild', () => {
    const store = new SignalKStore();
    let now = 1_000;
    const ais = clocked(store, () => now);
    store.applyFrame(frame({ 'vessels.a': at(36), 'vessels.b': at(37) }, now));
    const [firstA, firstB] = ais.list();

    // Only b moved. Every identity check downstream (rows, overlay features, keyed each blocks)
    // should stop at a, instead of treating the whole fleet as new.
    now = 2_000;
    store.applyFrame(frame({ 'vessels.b': at(37.5) }, now));
    const [nextA, nextB] = ais.list();
    expect(nextA).toBe(firstA);
    expect(nextB).not.toBe(firstB);
    expect(nextB.position.latitude).toBe(37.5);
  });

  it('rebuilds a view when a value changes inside the same millisecond', () => {
    const store = new SignalKStore();
    const now = 5_000;
    const ais = clocked(store, () => now);
    // Two worker flushes can share a wall-clock millisecond, so a timestamp is not a safe memo key:
    // keying on one would serve the stale view here, silently.
    store.applyFrame(frame({ 'vessels.a': at(36) }, now));
    expect(ais.list()[0].position.latitude).toBe(36);
    store.applyFrame(frame({ 'vessels.a': at(38) }, now));
    expect(ais.list()[0].position.latitude).toBe(38);
  });

  it('reuses the view when a target republishes an identical fix', () => {
    const store = new SignalKStore();
    let now = 1_000;
    const ais = clocked(store, () => now);
    store.applyFrame(frame({ 'vessels.a': at(36) }, now));
    const first = ais.list()[0];
    now = 2_000;
    store.applyFrame(frame({ 'vessels.a': at(36) }, now));
    expect(ais.list()[0]).toBe(first);
  });

  it('drops the memo for a pruned vessel rather than holding it for the session', () => {
    const store = new SignalKStore();
    let now = 1_000;
    const ais = clocked(store, () => now);
    store.applyFrame(frame({ 'vessels.a': at(36) }, now));
    const first = ais.list()[0];
    now = 1_000_000;
    store.pruneAis(now, 30_000);
    expect(ais.list()).toHaveLength(0);
    store.applyFrame(frame({ 'vessels.a': at(36) }, now));
    expect(ais.list()[0]).not.toBe(first);
  });
});

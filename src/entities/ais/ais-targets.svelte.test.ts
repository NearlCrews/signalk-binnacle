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

import { describe, expect, it } from 'vitest';
import type { SKFrame } from '$shared/signalk';
import { SignalKStore } from '$shared/signalk';
import { AisTargets, parseIso8601DurationSeconds } from './ais-targets.svelte';

function frame(ais: Record<string, Record<string, unknown>>, epoch = 1): SKFrame {
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

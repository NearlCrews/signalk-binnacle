import { describe, expect, it, vi } from 'vitest';

import { AisTargets, type AisTargetView } from '$entities/ais';
import type { Assessment, Severity } from '$entities/collision';
import { mapThemePaint } from '$shared/map';
import { geodesicDestination } from '$shared/nav';
import { SignalKStore } from '$shared/signalk';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { buildFeatures, createAisVectorsOverlay } from './ais-vectors-overlay';

const LAYER_ID = 'binnacle-ais-vectors-line';
const SOURCE_ID = 'binnacle-ais-vectors';

function noSeverity(): Map<string, Severity> {
  return new Map();
}

// A stable reference, like the production collision.assessment getter (a $derived that returns the
// same object between recomputes, and a frozen singleton when clear); the overlay's dirty check is
// reference-based, so a fresh object per call would defeat it.
const EMPTY_ASSESSMENT: Assessment = { contacts: [], worst: 'clear', unassessed: [] };
function emptyAssessment(): Assessment {
  return EMPTY_ASSESSMENT;
}

function movingTarget(overrides: Partial<AisTargetView> = {}): AisTargetView {
  return {
    id: 'target-1',
    position: { latitude: 10, longitude: 20 },
    cogRad: 0,
    sogMps: 5,
    ...overrides,
  };
}

describe('geodesicDestination', () => {
  it('heading due north 111320 m lands near lat 1 from the equator', () => {
    const [lon, lat] = geodesicDestination(0, 0, 0, 111_320);
    expect(lat).toBeCloseTo(1, 1);
    expect(lon).toBeCloseTo(0, 4);
  });

  it('heading due east 1852 m from the equator lands near lon 0.01667', () => {
    const [lon, lat] = geodesicDestination(0, 0, Math.PI / 2, 1852);
    expect(lon).toBeCloseTo(0.01667, 3);
    expect(lat).toBeCloseTo(0, 4);
  });
});

describe('buildFeatures', () => {
  it('produces one LineString for a moving target', () => {
    const target = movingTarget({ cogRad: 0, sogMps: 5 });
    const features = buildFeatures([target], noSeverity());
    expect(features).toHaveLength(1);
    expect(features[0].geometry.type).toBe('LineString');
  });

  it('first coordinate matches the target position in GeoJSON order', () => {
    const target = movingTarget({
      position: { latitude: 10, longitude: 20 },
      cogRad: 0,
      sogMps: 5,
    });
    const features = buildFeatures([target], noSeverity());
    const coords = (features[0].geometry as GeoJSON.LineString).coordinates;
    expect(coords[0]).toEqual([20, 10]);
  });

  it('second coordinate is north of the origin when heading due north', () => {
    const target = movingTarget({
      position: { latitude: 10, longitude: 20 },
      cogRad: 0,
      sogMps: 5,
    });
    const features = buildFeatures([target], noSeverity());
    const coords = (features[0].geometry as GeoJSON.LineString).coordinates;
    expect(coords[1][1]).toBeGreaterThan(coords[0][1]);
    expect(coords[1][0]).toBeCloseTo(20, 3);
  });

  it('omits targets whose sogMps is below MIN_SOG_MPS', () => {
    const target = movingTarget({ sogMps: 0.1 });
    expect(buildFeatures([target], noSeverity())).toHaveLength(0);
  });

  it('omits targets with undefined sogMps', () => {
    const target = movingTarget({ sogMps: undefined });
    expect(buildFeatures([target], noSeverity())).toHaveLength(0);
  });

  it('omits targets with undefined cogRad', () => {
    const target = movingTarget({ cogRad: undefined });
    expect(buildFeatures([target], noSeverity())).toHaveLength(0);
  });

  it('assigns severity from the map when present', () => {
    const target = movingTarget({ id: 'vessel-danger', cogRad: 0, sogMps: 5 });
    const severity = new Map<string, Severity>([['vessel-danger', 'danger']]);
    const features = buildFeatures([target], severity);
    expect(features[0].properties?.severity).toBe('danger');
  });

  it('defaults severity to clear when the target is not in the severity map', () => {
    const target = movingTarget({ id: 'vessel-ok', cogRad: 0, sogMps: 5 });
    const features = buildFeatures([target], noSeverity());
    expect(features[0].properties?.severity).toBe('clear');
  });

  it('handles multiple targets, mixing moving and stationary', () => {
    const moving = movingTarget({ id: 'mv', cogRad: 0, sogMps: 3 });
    const still = movingTarget({ id: 'st', cogRad: 0, sogMps: 0 });
    const features = buildFeatures([moving, still], noSeverity());
    expect(features).toHaveLength(1);
  });

  it('splits a course vector that crosses the antimeridian', () => {
    const target = movingTarget({
      position: { latitude: 0, longitude: 179.99 },
      cogRad: Math.PI / 2,
      sogMps: 20,
    });
    const [feature] = buildFeatures([target], noSeverity());

    expect(feature.geometry.type).toBe('MultiLineString');
    const lines = (feature.geometry as GeoJSON.MultiLineString).coordinates;
    expect(lines[0].at(-1)?.[0]).toBe(180);
    expect(lines[1][0][0]).toBe(-180);
  });
});

describe('createAisVectorsOverlay', () => {
  function makeTargets(initial: AisTargetView[]) {
    let list = initial;
    let version = 1;
    return {
      list: () => list,
      get version() {
        return version;
      },
      set(next: AisTargetView[]) {
        list = next;
        version += 1;
      },
      bump() {
        version += 1;
      },
    };
  }

  function dangerContact(target: AisTargetView): Assessment['contacts'][number] {
    return {
      id: target.id,
      position: target.position,
      cpaMeters: 100,
      tcpaSeconds: 60,
      severity: 'danger',
      source: 'provider',
    };
  }

  it('adds an empty line source and layer in the traffic band', async () => {
    const targets = makeTargets([]);
    const overlay = createAisVectorsOverlay(targets as never, emptyAssessment);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.id).toBe('ais-vectors');
    expect(overlay.title).toBe('AIS course vectors');
    expect(overlay.band).toBe('traffic');
    expect(overlay.supportsOpacity).toBe(true);
    expect(map.layers.has(LAYER_ID)).toBe(true);
    expect(map.sources.has(SOURCE_ID)).toBe(true);
  });

  it('sync populates features for moving targets on the first call', async () => {
    const target = movingTarget({ cogRad: 0, sogMps: 5 });
    const targets = makeTargets([target]);
    const overlay = createAisVectorsOverlay(targets as never, emptyAssessment);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = map.sources.get(SOURCE_ID);
    const fc = source?.data as GeoJSON.FeatureCollection;
    expect(fc.features).toHaveLength(1);
  });

  it('sync skips rebuild when version and contacts are unchanged', async () => {
    const target = movingTarget({ cogRad: 0, sogMps: 5 });
    const targets = makeTargets([target]);
    const assessment = emptyAssessment;
    const overlay = createAisVectorsOverlay(targets as never, assessment);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = map.sources.get(SOURCE_ID);
    if (!source) throw new Error(`${SOURCE_ID} not added`);
    const spy = vi.spyOn(source, 'setData');
    overlay.sync(ctx);
    expect(spy).not.toHaveBeenCalled();
  });

  it('throttles version-only churn to about 1 Hz and repaints immediately on a count change', async () => {
    let t = 0;
    const targets = makeTargets([movingTarget()]);
    const overlay = createAisVectorsOverlay(targets as never, emptyAssessment, () => t);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = map.sources.get(SOURCE_ID);
    if (!source) throw new Error(`${SOURCE_ID} not added`);
    const spy = vi.spyOn(source, 'setData');

    targets.bump();
    t = 250;
    overlay.sync(ctx);
    expect(spy).not.toHaveBeenCalled();

    t = 1_000;
    overlay.sync(ctx);
    expect(spy).toHaveBeenCalledTimes(1);

    targets.set([movingTarget(), movingTarget({ id: 'target-2' })]);
    t = 1_100;
    overlay.sync(ctx);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('removes a vector when target motion expires without an AIS version update', async () => {
    let now = 1_000;
    const store = new SignalKStore();
    const targets = new AisTargets(store, () => now);
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.expiring-motion',
          new Map<string, unknown>([
            ['navigation.position', { latitude: 10, longitude: 20 }],
            ['navigation.courseOverGroundTrue', 0],
            ['navigation.speedOverGround', 5],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: now,
    });
    const overlay = createAisVectorsOverlay(targets, emptyAssessment, () => now);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = map.sources.get(SOURCE_ID);
    if (!source) throw new Error(`${SOURCE_ID} not added`);
    const version = targets.version;
    expect((source.data as GeoJSON.FeatureCollection).features).toHaveLength(1);
    const spy = vi.spyOn(source, 'setData');

    now += 60_001;
    overlay.sync(ctx);

    expect(targets.version).toBe(version);
    expect(spy).toHaveBeenCalledOnce();
    expect((source.data as GeoJSON.FeatureCollection).features).toHaveLength(0);
  });

  it('repaints immediately when a contact severity changes', async () => {
    let t = 0;
    const target = movingTarget();
    const targets = makeTargets([target]);
    let assessment: Assessment = EMPTY_ASSESSMENT;
    const overlay = createAisVectorsOverlay(
      targets as never,
      () => assessment,
      () => t,
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = map.sources.get(SOURCE_ID);
    if (!source) throw new Error(`${SOURCE_ID} not added`);
    const spy = vi.spyOn(source, 'setData');

    assessment = { contacts: [dangerContact(target)], worst: 'danger', unassessed: [] };
    t = 100;
    overlay.sync(ctx);
    expect(spy).toHaveBeenCalledTimes(1);
    const fc = source.data as GeoJSON.FeatureCollection;
    expect(fc.features[0].properties?.severity).toBe('danger');
  });

  it('does not treat an identical severity set with a fresh identity as a change', async () => {
    let t = 0;
    const target = movingTarget();
    const targets = makeTargets([target]);
    let assessment: Assessment = {
      contacts: [dangerContact(target)],
      worst: 'danger',
      unassessed: [],
    };
    const overlay = createAisVectorsOverlay(
      targets as never,
      () => assessment,
      () => t,
    );
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    const source = map.sources.get(SOURCE_ID);
    if (!source) throw new Error(`${SOURCE_ID} not added`);
    const spy = vi.spyOn(source, 'setData');

    // The busy-anchorage steady state: each assessment recompute returns a fresh contacts array
    // carrying the same id-to-severity mapping, and that alone must not bypass the throttle.
    assessment = { contacts: [dangerContact(target)], worst: 'danger', unassessed: [] };
    targets.bump();
    t = 250;
    overlay.sync(ctx);
    expect(spy).not.toHaveBeenCalled();

    t = 1_000;
    overlay.sync(ctx);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('applyTheme resets the line-color paint property', async () => {
    const targets = makeTargets([]);
    const overlay = createAisVectorsOverlay(targets as never, emptyAssessment);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    const paint = mapThemePaint('night-red');
    overlay.applyTheme?.(ctx, paint);
    const calls = vi.mocked(map.setPaintProperty).mock.calls;
    const recolor = calls.find(([, prop]) => prop === 'line-color');
    expect(recolor).toBeDefined();
  });

  it('setOpacity scales the base opacity', async () => {
    const targets = makeTargets([]);
    const overlay = createAisVectorsOverlay(targets as never, emptyAssessment);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.setOpacity?.(ctx, 0.5);
    const calls = vi.mocked(map.setPaintProperty).mock.calls;
    const opCall = calls.find(([, prop]) => prop === 'line-opacity') as [string, string, number];
    expect(opCall).toBeDefined();
    expect(opCall[2]).toBeCloseTo(0.5 * 0.8);
  });

  it('remove cleans up the layer and source', async () => {
    const targets = makeTargets([]);
    const overlay = createAisVectorsOverlay(targets as never, emptyAssessment);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.remove(ctx);
    expect(map.layers.has(LAYER_ID)).toBe(false);
    expect(map.sources.has(SOURCE_ID)).toBe(false);
  });

  it('absorbs an opacity or theme change that lands before add attaches the layer', async () => {
    const targets = makeTargets([]);
    const overlay = createAisVectorsOverlay(targets as never, emptyAssessment);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    expect(() => overlay.setOpacity?.(ctx, 0.5)).not.toThrow();
    expect(() => overlay.applyTheme?.(ctx, mapThemePaint('night-red'))).not.toThrow();
    expect(map.setPaintProperty).not.toHaveBeenCalled();

    await overlay.add(ctx);
    overlay.setOpacity?.(ctx, 0.5);
    const calls = vi.mocked(map.setPaintProperty).mock.calls;
    expect(calls.some(([id, prop]) => id === LAYER_ID && prop === 'line-opacity')).toBe(true);
  });
});

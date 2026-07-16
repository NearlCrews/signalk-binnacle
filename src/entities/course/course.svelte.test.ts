import { describe, expect, it } from 'vitest';
import { OwnVessel } from '$entities/vessel';
import { SignalKStore } from '$shared/signalk';
import { CourseGuidance } from './course.svelte';

function storeWith(self: Record<string, unknown>): SignalKStore {
  const store = new SignalKStore();
  applySelf(store, self, 1);
  return store;
}

function applySelf(store: SignalKStore, self: Record<string, unknown>, epoch: number): void {
  store.applyFrame({
    self: new Map(Object.entries(self)),
    ais: new Map(),
    connection: { phase: 'open', attempt: 0 },
    epoch,
  });
}

describe('CourseGuidance', () => {
  it('reports no active leg when there is no nextPoint', () => {
    const store = storeWith({ 'navigation.position': { latitude: 0, longitude: 0 } });
    const g = new CourseGuidance(store, new OwnVessel(store));
    expect(g.active).toBe(false);
  });

  it('uses provider calcValues when present and flags the source server', () => {
    const store = storeWith({
      'navigation.position': { latitude: 0, longitude: 0 },
      'navigation.course.nextPoint': { position: { latitude: 0, longitude: 1 }, name: 'B' },
      // calcValues streams one leaf delta per field, never the parent object.
      'navigation.course.calcValues.crossTrackError': 12,
      'navigation.course.calcValues.distance': 1852,
      'navigation.course.calcValues.bearingTrue': 1.57,
      'navigation.course.calcValues.velocityMadeGood': 3,
    });
    const g = new CourseGuidance(store, new OwnVessel(store));
    expect(g.active).toBe(true);
    expect(g.source).toBe('server');
    expect(g.crossTrackErrorMeters).toBe(12);
    expect(g.distanceToNextMeters).toBe(1852);
  });

  it('rejects malformed server calculations and route extents', () => {
    const store = storeWith({
      'navigation.position': { latitude: 0, longitude: 0 },
      'navigation.course.nextPoint': { position: { latitude: 0, longitude: 1 } },
      'navigation.course.previousPoint': { position: { latitude: 95, longitude: 0 } },
      'navigation.course.activeRoute': {
        href: '/resources/routes/r',
        pointIndex: 4,
        pointTotal: 2,
      },
      'navigation.course.arrivalCircle': -20,
      'navigation.course.calcValues.distance': Number.NaN,
      'navigation.course.calcValues.bearingTrue': Number.POSITIVE_INFINITY,
      'navigation.course.calcValues.estimatedTimeOfArrival': 'not-a-date',
    });
    const g = new CourseGuidance(store, new OwnVessel(store));
    expect(g.source).toBe('computed');
    expect(g.activePointIndex).toBeUndefined();
    expect(g.canAdvanceRoute).toBe(false);
    expect(g.canRetreatRoute).toBe(false);
    expect(g.distanceToNextMeters).toBeGreaterThan(0);
    expect(g.bearingToNextRad).toBeTypeOf('number');
    expect(g.estimatedTimeOfArrivalIso).toBeUndefined();
  });

  it('only enables route stepping when the server supplies a valid extent', () => {
    const store = storeWith({ 'navigation.position': { latitude: 0, longitude: 0 } });
    const g = new CourseGuidance(store, new OwnVessel(store));
    g.seed(
      { activeRoute: { href: '/resources/routes/r', pointIndex: 1, pointTotal: 3 } },
      undefined,
    );
    expect(g.canRetreatRoute).toBe(true);
    expect(g.canAdvanceRoute).toBe(true);
    expect(g.isLastPoint).toBe(false);
    g.seed(
      { activeRoute: { href: '/resources/routes/r', pointIndex: 2, pointTotal: 3 } },
      undefined,
    );
    expect(g.canAdvanceRoute).toBe(false);
    expect(g.isLastPoint).toBe(true);
  });

  it('keeps pointIndex in traversal order for a reversed route', () => {
    const store = storeWith({ 'navigation.position': { latitude: 0, longitude: 0 } });
    const g = new CourseGuidance(store, new OwnVessel(store));
    g.seed(
      {
        activeRoute: {
          href: '/resources/routes/r',
          pointIndex: 0,
          pointTotal: 3,
          reverse: true,
        },
      },
      undefined,
    );
    expect(g.canAdvanceRoute).toBe(true);
    expect(g.canRetreatRoute).toBe(false);
    expect(g.isLastPoint).toBe(false);
    expect(g.routeReversed).toBe(true);
    g.seed(
      {
        activeRoute: {
          href: '/resources/routes/r',
          pointIndex: 2,
          pointTotal: 3,
          reverse: true,
        },
      },
      undefined,
    );
    expect(g.canAdvanceRoute).toBe(false);
    expect(g.canRetreatRoute).toBe(true);
    expect(g.isLastPoint).toBe(true);
  });

  it('keeps calcValues live from streamed leaf deltas, not just the REST seed', () => {
    const store = storeWith({
      'navigation.position': { latitude: 0, longitude: 0 },
      'navigation.course.nextPoint': { position: { latitude: 0, longitude: 1 }, name: 'B' },
    });
    const g = new CourseGuidance(store, new OwnVessel(store));
    // A REST hydration seeds the first distance, then a later streamed leaf must override it.
    g.seed(undefined, { distance: 2000 }, 1);
    expect(g.distanceToNextMeters).toBe(2000);
    applySelf(store, { 'navigation.course.calcValues.distance': 1500 }, 10);
    expect(g.distanceToNextMeters).toBe(1500);
    expect(g.source).toBe('server');
  });

  it("exposes the server's estimatedTimeOfArrival when present and undefined otherwise", () => {
    const withEta = storeWith({
      'navigation.position': { latitude: 0, longitude: 0 },
      'navigation.course.nextPoint': { position: { latitude: 0, longitude: 1 }, name: 'B' },
      'navigation.course.calcValues.crossTrackError': 0,
      'navigation.course.calcValues.estimatedTimeOfArrival': '2026-06-10T18:30:00Z',
    });
    expect(new CourseGuidance(withEta, new OwnVessel(withEta)).estimatedTimeOfArrivalIso).toBe(
      '2026-06-10T18:30:00Z',
    );

    const computed = storeWith({
      'navigation.position': { latitude: 0, longitude: 0 },
      'navigation.course.nextPoint': { position: { latitude: 0, longitude: 1 } },
      'navigation.course.previousPoint': { position: { latitude: 0, longitude: 0 } },
    });
    expect(
      new CourseGuidance(computed, new OwnVessel(computed)).estimatedTimeOfArrivalIso,
    ).toBeUndefined();
  });

  it('seeds the leg from a hydration snapshot and clear wipes every course cell', () => {
    const store = storeWith({ 'navigation.position': { latitude: 0, longitude: 0 } });
    const g = new CourseGuidance(store, new OwnVessel(store));
    expect(g.active).toBe(false);
    g.seed(
      {
        nextPoint: { position: { latitude: 0, longitude: 1 }, name: 'B' },
        previousPoint: { position: { latitude: 0, longitude: 0 } },
        activeRoute: { href: '/resources/routes/r', pointIndex: 0, pointTotal: 2 },
        arrivalCircle: 50,
      },
      { crossTrackError: 7, distance: 1852 },
    );
    expect(g.active).toBe(true);
    expect(g.source).toBe('server');
    expect(g.nextPointName).toBe('B');
    expect(g.distanceToNextMeters).toBe(1852);
    g.clear();
    expect(g.active).toBe(false);
    expect(g.source).toBe('computed');
    expect(g.isLastPoint).toBe(false);
  });

  it('skips seeding when a stream delta wrote a course cell after the hydrate began', () => {
    const store = storeWith({ 'navigation.position': { latitude: 0, longitude: 0 } });
    const g = new CourseGuidance(store, new OwnVessel(store));
    const hydrateStarted = 1000;
    // A skip advanced the route while the REST hydration was in flight.
    applySelf(
      store,
      { 'navigation.course.nextPoint': { position: { latitude: 1, longitude: 1 }, name: 'C' } },
      1500,
    );
    g.seed(
      { nextPoint: { position: { latitude: 0, longitude: 1 }, name: 'B' } },
      undefined,
      hydrateStarted,
    );
    expect(g.nextPointName).toBe('C');
  });

  it('seeds when the only course deltas predate the hydrate', () => {
    const store = storeWith({ 'navigation.position': { latitude: 0, longitude: 0 } });
    const g = new CourseGuidance(store, new OwnVessel(store));
    applySelf(
      store,
      { 'navigation.course.nextPoint': { position: { latitude: 1, longitude: 1 }, name: 'C' } },
      500,
    );
    g.seed({ nextPoint: { position: { latitude: 0, longitude: 1 }, name: 'B' } }, undefined, 1000);
    expect(g.nextPointName).toBe('B');
  });

  it('latches arrival against boundary jitter and clears past the exit margin', () => {
    const store = storeWith({
      'navigation.position': { latitude: 0, longitude: 0.000899 },
      'navigation.course.nextPoint': { position: { latitude: 0, longitude: 0 }, name: 'B' },
      'navigation.course.calcValues.crossTrackError': 0,
      'navigation.course.calcValues.distance': 500,
    });
    const g = new CourseGuidance(store, new OwnVessel(store));
    // At the (default 100 m) circle: arrived.
    expect(g.arrived).toBe(true);
    // Jitter 5 percent outside the circle: still latched.
    applySelf(store, { 'navigation.position': { latitude: 0, longitude: 0.000944 } }, 2);
    expect(g.arrived).toBe(true);
    // 25 percent outside, past the exit margin: a real departure clears the latch.
    applySelf(store, { 'navigation.position': { latitude: 0, longitude: 0.001124 } }, 3);
    expect(g.arrived).toBe(false);
  });

  it('does not use a provider distance to trigger arrival without matching fresh geometry', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 1000 });
    applySelf(
      store,
      {
        'navigation.position': { latitude: 0, longitude: 0 },
        'navigation.course.nextPoint': { position: { latitude: 0, longitude: 1 } },
        'navigation.course.calcValues.distance': 50,
      },
      clock.now,
    );
    const g = new CourseGuidance(store, new OwnVessel(store, clock), clock);
    expect(g.distanceToNextMeters).toBe(50);
    expect(g.arrived).toBe(false);
    clock.now += 30_001;
    expect(g.source).toBe('computed');
    expect(g.distanceToNextMeters).toBeUndefined();
    expect(g.arrived).toBe(false);
  });

  it('the arrival latch resets when the next point changes', () => {
    const store = storeWith({
      'navigation.position': { latitude: 0, longitude: 0.00045 },
      'navigation.course.nextPoint': { position: { latitude: 0, longitude: 0 }, name: 'B' },
      'navigation.course.calcValues.crossTrackError': 0,
      'navigation.course.calcValues.distance': 50,
    });
    const g = new CourseGuidance(store, new OwnVessel(store));
    expect(g.arrived).toBe(true);
    // A new active point at a distance inside the old latch's jitter band must read not-arrived:
    // the latch belongs to the previous point.
    applySelf(
      store,
      {
        'navigation.course.nextPoint': { position: { latitude: 1, longitude: 0 }, name: 'C' },
        'navigation.course.calcValues.distance': 110,
      },
      2,
    );
    expect(g.arrived).toBe(false);
  });

  it('clears arrival immediately when the own-vessel fix becomes stale', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 1000 });
    applySelf(
      store,
      {
        'navigation.position': { latitude: 0, longitude: 0.00045 },
        'navigation.course.nextPoint': { position: { latitude: 0, longitude: 0 } },
        'navigation.course.calcValues.distance': 50,
      },
      clock.now,
    );
    const guidance = new CourseGuidance(store, new OwnVessel(store, clock), clock);
    expect(guidance.arrived).toBe(true);
    clock.now += 60_000;
    expect(guidance.arrived).toBe(false);
  });

  it('computes the derived values when calcValues is absent and flags the source computed', () => {
    const store = storeWith({
      'navigation.position': { latitude: 0, longitude: 0 },
      'navigation.speedOverGround': 3,
      'navigation.courseOverGroundTrue': 1.5,
      'navigation.course.nextPoint': { position: { latitude: 0, longitude: 1 } },
      'navigation.course.previousPoint': { position: { latitude: 0, longitude: 0 } },
    });
    const g = new CourseGuidance(store, new OwnVessel(store));
    expect(g.active).toBe(true);
    expect(g.source).toBe('computed');
    expect(g.distanceToNextMeters).toBeGreaterThan(0);
    expect(typeof g.bearingToNextRad).toBe('number');
  });

  it('computes VMG and TTG end-to-end when calcValues is absent', () => {
    // Boat at origin, mark due east (roughly 111 km away at 1 degree latitude separation).
    // SOG 3 m/s, COG due east (Pi/2 radians): VMG toward the mark should equal SOG (full projection).
    const next = { latitude: 0, longitude: 1 };
    const store = storeWith({
      'navigation.position': { latitude: 0, longitude: 0 },
      'navigation.speedOverGround': 3,
      'navigation.courseOverGroundTrue': Math.PI / 2,
      'navigation.course.nextPoint': { position: next },
    });
    const g = new CourseGuidance(store, new OwnVessel(store));
    expect(g.source).toBe('computed');
    // VMG: SOG * cos(COG - bearingToMark). Mark is due east; COG is due east; cos(0) = 1.
    expect(g.velocityMadeGoodMps).toBeCloseTo(3, 4);
    // TTG: distance / SOG. The distance to 1 degree of longitude at equator is ~111 km.
    const d = g.distanceToNextMeters;
    expect(d).toBeDefined();
    expect(g.timeToGoSeconds).toBeCloseTo((d as number) / 3, 0);
  });
});

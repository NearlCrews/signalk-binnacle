import { describe, expect, it } from 'vitest';
import { AisTargets, type AisTargetView } from '$entities/ais';
import { OwnVessel } from '$entities/vessel';
import { degreesToRadians, knotsToMetersPerSecond } from '$shared/lib';
import { createThresholds, DEFAULT_THRESHOLDS } from '$shared/settings';
import { SignalKStore } from '$shared/signalk';
import { assessContacts, CollisionAssessment } from './collision.svelte';

const ownStationary = { position: { latitude: 0, longitude: 0 }, sogMps: 0, cogRad: 0 };

function target(partial: Partial<AisTargetView>): AisTargetView {
  return { id: 't', position: { latitude: 0, longitude: 0 }, ...partial };
}

function dangerStore(targetId: string): SignalKStore {
  const store = new SignalKStore();
  store.applyFrame({
    self: new Map<string, unknown>([['navigation.position', { latitude: 0, longitude: 0 }]]),
    ais: new Map([
      [
        targetId,
        new Map<string, unknown>([
          ['navigation.position', { latitude: 0.01, longitude: 0 }],
          ['navigation.closestApproach', { distance: 100, timeTo: 60 }],
        ]),
      ],
    ]),
    connection: { phase: 'open', attempt: 0 },
    epoch: Date.now(),
  });
  return store;
}

describe('assessContacts', () => {
  it('stands down computed-only contacts without an own position', () => {
    const r = assessContacts(undefined, [target({})], DEFAULT_THRESHOLDS);
    expect(r.contacts).toHaveLength(0);
    expect(r.worst).toBe('clear');
  });

  it('still classifies provider contacts without an own position', () => {
    // Provider CPA and TCPA come from the server, so a lost or stale own fix must not
    // silence them.
    const t = target({ id: 'p', cpaMeters: 100, tcpaSeconds: 120 });
    const r = assessContacts(undefined, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts[0]?.severity).toBe('danger');
    expect(r.worst).toBe('danger');
  });

  it('treats a target reporting SOG but no COG as stationary', () => {
    // A fabricated due-north course for this southern target would read as closing and alarm;
    // with no course it must count as stationary, and a stationary pair never closes.
    const t = target({
      id: 'nocog',
      position: { latitude: -1852 / 111320, longitude: 0 },
      sogMps: knotsToMetersPerSecond(10),
    });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts).toHaveLength(0);
  });

  it('returns the same all-clear object every pass for stable identity', () => {
    const a = assessContacts(ownStationary, [], DEFAULT_THRESHOLDS);
    const b = assessContacts(undefined, [], DEFAULT_THRESHOLDS);
    expect(a).toBe(b);
    expect(a.worst).toBe('clear');
  });

  it('prefers the provider CPA/TCPA when present and flags the source', () => {
    const t = target({ id: 'p', cpaMeters: 100, tcpaSeconds: 120 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts[0].source).toBe('provider');
    expect(r.contacts[0].severity).toBe('danger');
    expect(r.worst).toBe('danger');
  });

  it('drops a provider contact whose CPA is in the past (negative TCPA)', () => {
    // An opening or passed target reports a negative TCPA; a small CPA must not alarm.
    const t = target({ id: 'past', cpaMeters: 50, tcpaSeconds: -30 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts).toHaveLength(0);
    expect(r.worst).toBe('clear');
  });

  it('rejects a negative provider CPA and falls back to local geometry', () => {
    const t = target({
      id: 'invalid-provider',
      position: { latitude: 1852 / 111320, longitude: 0 },
      sogMps: knotsToMetersPerSecond(10),
      cogRad: degreesToRadians(180),
      cpaMeters: -50,
      tcpaSeconds: 60,
    });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts[0]?.source).toBe('computed');
    expect(r.contacts[0]?.cpaMeters).toBeGreaterThanOrEqual(0);
  });

  it('computes CPA/TCPA when the provider value is absent and flags it computed', () => {
    // 1 nm due north closing south at about 10 kn: inside the danger or warning band.
    const t = target({
      id: 'c',
      position: { latitude: 1852 / 111320, longitude: 0 },
      sogMps: knotsToMetersPerSecond(10),
      cogRad: degreesToRadians(180),
    });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts[0].source).toBe('computed');
    expect(['danger', 'warning']).toContain(r.contacts[0].severity);
  });

  it('classifies a distant opening target as clear and drops it', () => {
    const t = target({
      id: 'o',
      position: { latitude: 0.2, longitude: 0 },
      sogMps: knotsToMetersPerSecond(10),
      cogRad: degreesToRadians(0),
    });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts).toHaveLength(0);
    expect(r.worst).toBe('clear');
  });

  it('ranks danger before warning', () => {
    const danger = target({ id: 'd', cpaMeters: 100, tcpaSeconds: 60 });
    const warn = target({ id: 'w', cpaMeters: 1500, tcpaSeconds: 900 });
    const r = assessContacts(ownStationary, [warn, danger], DEFAULT_THRESHOLDS);
    expect(r.contacts[0].id).toBe('d');
  });
});

describe('assessContacts near-stationary gate', () => {
  // A slow target closing on the own vessel: about 111 m north, drifting south at 0.3 m/s (under
  // 1 kt). Without the gate this is a computed danger; the gate is what suppresses the marina noise.
  const slowCloser = target({
    id: 'moored',
    position: { latitude: 0.001, longitude: 0 },
    sogMps: 0.3,
    cogRad: degreesToRadians(180),
  });
  const ownUnderway = {
    position: { latitude: 0, longitude: 0 },
    sogMps: knotsToMetersPerSecond(5),
    cogRad: degreesToRadians(0),
  };

  it('skips a near-stationary target when the own vessel is also near stationary', () => {
    const r = assessContacts(ownStationary, [slowCloser], DEFAULT_THRESHOLDS);
    expect(r.contacts).toHaveLength(0);
  });

  it('still alarms when the own vessel is making way toward a slow target', () => {
    const r = assessContacts(ownUnderway, [slowCloser], DEFAULT_THRESHOLDS);
    expect(r.contacts).toHaveLength(1);
  });

  it('skips a slow target when anchored even if the own fix shows speed from GPS wander', () => {
    const anchored = assessContacts(ownUnderway, [slowCloser], DEFAULT_THRESHOLDS, undefined, true);
    expect(anchored.contacts).toHaveLength(0);
    const underway = assessContacts(
      ownUnderway,
      [slowCloser],
      DEFAULT_THRESHOLDS,
      undefined,
      false,
    );
    expect(underway.contacts).toHaveLength(1);
  });
});

describe('assessContacts downgrade hysteresis', () => {
  // DEFAULT_THRESHOLDS: danger 926 m / 600 s, warning 1852 m / 1200 s.
  const previous = (severity: 'danger' | 'warning') =>
    new Map<string, 'danger' | 'warning'>([['t', severity]]);

  it('holds danger while the value sits inside the 10 percent margin', () => {
    const t = target({ cpaMeters: 1000, tcpaSeconds: 60 }); // over 926, under 926 * 1.1
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, previous('danger'));
    expect(r.contacts[0]?.severity).toBe('danger');
  });

  it('downgrades danger to warning once the margin is cleared', () => {
    const t = target({ cpaMeters: 1050, tcpaSeconds: 60 }); // over 926 * 1.1
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, previous('danger'));
    expect(r.contacts[0]?.severity).toBe('warning');
  });

  it('holds warning inside the margin and drops it once cleared', () => {
    const inside = target({ cpaMeters: 1900, tcpaSeconds: 60 }); // over 1852, under 1852 * 1.1
    const held = assessContacts(ownStationary, [inside], DEFAULT_THRESHOLDS, previous('warning'));
    expect(held.contacts[0]?.severity).toBe('warning');

    const outside = target({ cpaMeters: 2100, tcpaSeconds: 60 }); // over 1852 * 1.1
    const clear = assessContacts(ownStationary, [outside], DEFAULT_THRESHOLDS, previous('warning'));
    expect(clear.contacts).toHaveLength(0);
  });

  it('never delays an upgrade', () => {
    const t = target({ cpaMeters: 100, tcpaSeconds: 60 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, previous('warning'));
    expect(r.contacts[0]?.severity).toBe('danger');
  });

  it('classifies a returning contact immediately, with no held severity', () => {
    const t = target({ cpaMeters: 100, tcpaSeconds: 60 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, new Map());
    expect(r.contacts[0]?.severity).toBe('danger');
  });
});

describe('assessContacts with custom Thresholds', () => {
  it('uses a supplied thresholds value instead of defaults', () => {
    // Under DEFAULT_THRESHOLDS, a contact at CPA 200 m and TCPA 120 s is 'danger'
    // (danger CPA is 926 m). With a custom thresholds where dangerCpaMeters is 100 m,
    // the same contact sits above the danger band and clears both warn and danger, so it
    // must not appear in the contact list.
    const tightThresholds = {
      dangerCpaMeters: 100,
      dangerTcpaSeconds: 60,
      warningCpaMeters: 150,
      warningTcpaSeconds: 120,
    };
    const t = target({ id: 'far', cpaMeters: 200, tcpaSeconds: 120 });
    // Under defaults this would be danger.
    expect(assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS).contacts[0]?.severity).toBe(
      'danger',
    );
    // Under tight thresholds, 200 m CPA exceeds the 150 m warning band: contact is clear.
    const r = assessContacts(ownStationary, [t], tightThresholds);
    expect(r.contacts).toHaveLength(0);
    expect(r.worst).toBe('clear');
  });
});

describe('CollisionAssessment acknowledge', () => {
  it('suppresses the acknowledged contact and re-arms when the worst contact changes', () => {
    const store = dangerStore('vessels.a');
    const collision = new CollisionAssessment(
      new OwnVessel(store),
      new AisTargets(store),
      createThresholds(),
    );
    expect(collision.assessment.contacts).toHaveLength(1);
    expect(collision.suppressed).toBe(false);

    collision.acknowledge();
    expect(collision.suppressed).toBe(true);

    // A different vessel becomes the worst contact, which re-arms the alert.
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.b',
          new Map<string, unknown>([
            ['navigation.position', { latitude: 0.005, longitude: 0 }],
            ['navigation.closestApproach', { distance: 50, timeTo: 30 }],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    expect(collision.suppressed).toBe(false);
  });

  it('re-arms when the situation clears and the same contact returns', () => {
    const store = dangerStore('vessels.a');
    const collision = new CollisionAssessment(
      new OwnVessel(store),
      new AisTargets(store),
      createThresholds(),
    );
    collision.acknowledge();
    expect(collision.suppressed).toBe(true);

    // The contact opens (negative TCPA), so the assessment goes all-clear.
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([
            ['navigation.closestApproach', { distance: 100, timeTo: -10 }],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    expect(collision.assessment.contacts).toHaveLength(0);

    // The same vessel closes again at the same severity: a new event, never auto-suppressed.
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([['navigation.closestApproach', { distance: 100, timeTo: 60 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    expect(collision.assessment.worst).toBe('danger');
    expect(collision.suppressed).toBe(false);
  });
});

describe('CollisionAssessment hysteresis', () => {
  it('holds a danger grade through threshold-level scatter', () => {
    // The contact starts well inside danger, scatters just past the 926 m danger CPA, and must
    // hold danger; a real retreat past the margin downgrades.
    const store = dangerStore('vessels.a');
    const collision = new CollisionAssessment(
      new OwnVessel(store),
      new AisTargets(store),
      createThresholds(),
    );
    expect(collision.assessment.worst).toBe('danger');

    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([['navigation.closestApproach', { distance: 950, timeTo: 60 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    expect(collision.assessment.worst).toBe('danger');

    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([
            ['navigation.closestApproach', { distance: 1100, timeTo: 60 }],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    expect(collision.assessment.worst).toBe('warning');
  });
});

describe('CollisionAssessment escalating', () => {
  it('escalates when the worst contact is inside the hard inner ring', () => {
    // dangerStore puts a contact at CPA 100 m, TCPA 60 s, inside the 185 m and 120 s inner ring.
    const store = dangerStore('vessels.a');
    const collision = new CollisionAssessment(
      new OwnVessel(store),
      new AisTargets(store),
      createThresholds(),
    );
    expect(collision.escalating).toBe(true);
  });

  it('does not escalate a danger that is outside the inner ring', () => {
    // CPA 400 m, TCPA 300 s: a danger under the default thresholds, but outside the inner ring, so
    // mute and acknowledge still apply.
    const store = new SignalKStore();
    store.applyFrame({
      self: new Map<string, unknown>([['navigation.position', { latitude: 0, longitude: 0 }]]),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([
            ['navigation.position', { latitude: 0.01, longitude: 0 }],
            ['navigation.closestApproach', { distance: 400, timeTo: 300 }],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    const collision = new CollisionAssessment(
      new OwnVessel(store),
      new AisTargets(store),
      createThresholds(),
    );
    expect(collision.assessment.worst).toBe('danger');
    expect(collision.escalating).toBe(false);
  });
});

describe('CollisionAssessment own-vessel freshness', () => {
  it('stands down computed CPA when own motion is stale even with a fresh position', () => {
    const store = new SignalKStore();
    const clock = $state({ now: 100_000 });
    store.applyFrame({
      self: new Map<string, unknown>([
        ['navigation.position', { latitude: 0, longitude: 0 }],
        ['navigation.speedOverGround', knotsToMetersPerSecond(5)],
        ['navigation.courseOverGroundTrue', 0],
      ]),
      ais: new Map([
        [
          'vessels.closing',
          new Map<string, unknown>([
            ['navigation.position', { latitude: 1852 / 111320, longitude: 0 }],
            ['navigation.speedOverGround', knotsToMetersPerSecond(10)],
            ['navigation.courseOverGroundTrue', degreesToRadians(180)],
          ]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 80_000,
    });
    // Refresh only the position. SOG and COG remain beyond the 10-second freshness window.
    store.applyFrame({
      self: new Map([['navigation.position', { latitude: 0, longitude: 0 }]]),
      connection: { phase: 'open', attempt: 0 },
      epoch: 99_000,
    });
    const collision = new CollisionAssessment(
      new OwnVessel(store, clock),
      new AisTargets(store, () => clock.now),
      createThresholds(),
    );

    expect(collision.assessment.contacts).toHaveLength(0);
  });
});

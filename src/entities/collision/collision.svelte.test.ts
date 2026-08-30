import { describe, expect, it } from 'vitest';
import { AisTargets, type AisTargetView } from '$entities/ais';
import { OwnVessel } from '$entities/vessel';
import { degreesToRadians, knotsToMetersPerSecond } from '$shared/lib';
import { createThresholds, DEFAULT_THRESHOLDS } from '$shared/settings';
import { SignalKStore } from '$shared/signalk';
import { assessContacts, CollisionAssessment, type CollisionContact } from './collision.svelte';

const ownStationary = { position: { latitude: 0, longitude: 0 }, sogMps: 0, cogRad: 0 };

function target(partial: Partial<AisTargetView>): AisTargetView {
  return { id: 't', kind: 'vessel', position: { latitude: 0, longitude: 0 }, ...partial };
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
  it('grades computed-only contacts unassessed with own-fix-lost when the own fix is absent', () => {
    // Silently dropping them would leave every AIS display reading healthy while the lookout is
    // blind. They surface as unassessed instead, with a reason naming the own vessel's degradation,
    // and the top-level flag lets a chip say why. No own position exists to range them from.
    const t = target({});
    const r = assessContacts(undefined, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts).toHaveLength(0);
    expect(r.worst).toBe('clear');
    expect(r.unassessed).toEqual([
      { id: 't', name: undefined, position: t.position, reason: 'own-fix-lost' },
    ]);
    expect(r.ownFixLost).toBe(true);
    expect(r.nearestUnassessed).toBeUndefined();
  });

  it('still classifies provider contacts without an own position', () => {
    // Provider CPA and TCPA come from the server, so a lost or stale own fix must not
    // silence them, and a fleet fully carried by the provider is not a degraded lookout.
    const t = target({ id: 'p', cpaMeters: 100, tcpaSeconds: 120 });
    const r = assessContacts(undefined, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts[0]?.severity).toBe('danger');
    expect(r.worst).toBe('danger');
    expect(r.unassessed).toHaveLength(0);
    expect(r.ownFixLost).toBe(false);
  });

  it('keeps ownFixLost false for target-side data gaps when the own fix is fresh', () => {
    const silent = target({ id: 'silent' });
    const r = assessContacts(ownStationary, [silent], DEFAULT_THRESHOLDS);
    expect(r.unassessed[0]?.reason).toBe('motion-unknown');
    expect(r.ownFixLost).toBe(false);
  });

  it('splits a mixed fleet on fix loss: provider contacts assessed, computed ones own-fix-lost', () => {
    const provider = target({ id: 'p', cpaMeters: 100, tcpaSeconds: 120 });
    const computed = target({ id: 'c', sogMps: knotsToMetersPerSecond(10) });
    const r = assessContacts(undefined, [provider, computed], DEFAULT_THRESHOLDS);
    expect(r.contacts.map((c) => c.id)).toEqual(['p']);
    expect(r.unassessed).toEqual([
      { id: 'c', name: undefined, position: computed.position, reason: 'own-fix-lost' },
    ]);
    expect(r.ownFixLost).toBe(true);
  });

  it('grades a moving target without a fresh course as unassessed, never stationary or clear', () => {
    // A fabricated due-north course for this southern target would read as closing and alarm, and
    // pretending it is stationary would make degraded assessment look like clear water. It is
    // unassessed: no contact, no fabricated CPA, and a visible data-quality state.
    const t = target({
      id: 'nocog',
      position: { latitude: -1852 / 111320, longitude: 0 },
      sogMps: knotsToMetersPerSecond(10),
    });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts).toHaveLength(0);
    expect(r.worst).toBe('clear');
    expect(r.unassessed).toEqual([
      { id: 'nocog', name: undefined, position: t.position, reason: 'course-unavailable' },
    ]);
  });

  it('returns the same all-clear object every pass for stable identity', () => {
    const a = assessContacts(ownStationary, [], DEFAULT_THRESHOLDS);
    const b = assessContacts(undefined, [], DEFAULT_THRESHOLDS);
    expect(a).toBe(b);
    expect(a.worst).toBe('clear');
    expect(a.unassessed).toHaveLength(0);
    expect(a.ownFixLost).toBe(false);
  });

  it('grades a target with no fresh motion data as unassessed unless its state says stationary', () => {
    const silent = target({ id: 'silent' });
    const anchoredTarget = target({ id: 'anchored', navigationState: 'anchored' });
    const mooredTarget = target({ id: 'moored', navigationState: 'moored' });
    const r = assessContacts(
      ownStationary,
      [silent, anchoredTarget, mooredTarget],
      DEFAULT_THRESHOLDS,
    );
    expect(r.contacts).toHaveLength(0);
    expect(r.unassessed).toEqual([
      { id: 'silent', name: undefined, position: silent.position, reason: 'motion-unknown' },
    ]);
  });

  it('keeps a fresh provider CPA authoritative for a target the local branch cannot assess', () => {
    const t = target({
      id: 'provider',
      sogMps: knotsToMetersPerSecond(10),
      cpaMeters: 100,
      tcpaSeconds: 120,
    });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts[0]?.source).toBe('provider');
    expect(r.unassessed).toHaveLength(0);
  });

  it('resumes assessment automatically when the course returns', () => {
    const noCog = target({
      id: 'recovers',
      position: { latitude: 1852 / 111320, longitude: 0 },
      sogMps: knotsToMetersPerSecond(10),
    });
    const first = assessContacts(
      { ...ownStationary, sogMps: knotsToMetersPerSecond(5) },
      [noCog],
      DEFAULT_THRESHOLDS,
    );
    expect(first.unassessed).toHaveLength(1);
    const withCog = { ...noCog, cogRad: degreesToRadians(180) };
    const second = assessContacts(
      { ...ownStationary, sogMps: knotsToMetersPerSecond(5) },
      [withCog],
      DEFAULT_THRESHOLDS,
    );
    expect(second.unassessed).toHaveLength(0);
    expect(second.contacts[0]?.severity).toBe('danger');
  });

  it('keeps a fresh slow target in the stationary gate rather than unassessed', () => {
    const slow = target({ id: 'slow', sogMps: knotsToMetersPerSecond(0.5) });
    const r = assessContacts(ownStationary, [slow], DEFAULT_THRESHOLDS);
    expect(r.contacts).toHaveLength(0);
    expect(r.unassessed).toHaveLength(0);
  });

  it('prefers the provider CPA/TCPA when present and flags the source', () => {
    const t = target({ id: 'p', cpaMeters: 100, tcpaSeconds: 120 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS);
    expect(r.contacts[0].source).toBe('provider');
    expect(r.contacts[0].severity).toBe('danger');
    expect(r.worst).toBe('danger');
  });

  it('drops a provider contact whose CPA is in the past with no prior active grade', () => {
    // An opening or passed target reports a negative TCPA; a small CPA must not alarm, and only a
    // contact that already graded warning or danger earns the receding hold.
    const t = target({ id: 'past', cpaMeters: 50, tcpaSeconds: -30 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, {
      recedingSince: new Map(),
    });
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
    const anchored = assessContacts(ownUnderway, [slowCloser], DEFAULT_THRESHOLDS, {
      anchored: true,
    });
    expect(anchored.contacts).toHaveLength(0);
    const underway = assessContacts(ownUnderway, [slowCloser], DEFAULT_THRESHOLDS, {
      anchored: false,
    });
    expect(underway.contacts).toHaveLength(1);
  });
});

describe('assessContacts downgrade hysteresis', () => {
  // DEFAULT_THRESHOLDS: danger 926 m / 600 s, warning 1852 m / 1200 s.
  const previous = (severity: 'danger' | 'warning') =>
    new Map<string, 'danger' | 'warning'>([['t', severity]]);

  it('holds danger while the value sits inside the 10 percent margin', () => {
    const t = target({ cpaMeters: 1000, tcpaSeconds: 60 }); // over 926, under 926 * 1.1
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, {
      previous: previous('danger'),
    });
    expect(r.contacts[0]?.severity).toBe('danger');
  });

  it('downgrades danger to warning once the margin is cleared', () => {
    const t = target({ cpaMeters: 1050, tcpaSeconds: 60 }); // over 926 * 1.1
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, {
      previous: previous('danger'),
    });
    expect(r.contacts[0]?.severity).toBe('warning');
  });

  it('holds warning inside the margin and drops it once cleared', () => {
    const inside = target({ cpaMeters: 1900, tcpaSeconds: 60 }); // over 1852, under 1852 * 1.1
    const held = assessContacts(ownStationary, [inside], DEFAULT_THRESHOLDS, {
      previous: previous('warning'),
    });
    expect(held.contacts[0]?.severity).toBe('warning');

    const outside = target({ cpaMeters: 2100, tcpaSeconds: 60 }); // over 1852 * 1.1
    const clear = assessContacts(ownStationary, [outside], DEFAULT_THRESHOLDS, {
      previous: previous('warning'),
    });
    expect(clear.contacts).toHaveLength(0);
  });

  it('never delays an upgrade', () => {
    const t = target({ cpaMeters: 100, tcpaSeconds: 60 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, {
      previous: previous('warning'),
    });
    expect(r.contacts[0]?.severity).toBe('danger');
  });

  it('classifies a returning contact immediately, with no held severity', () => {
    const t = target({ cpaMeters: 100, tcpaSeconds: 60 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, { previous: new Map() });
    expect(r.contacts[0]?.severity).toBe('danger');
  });
});

describe('assessContacts receding hold', () => {
  const previousDanger = () => new Map<string, 'danger'>([['t', 'danger']]);

  it('holds a provider contact past CPA at its prior grade, flagged receding', () => {
    const recedingSince = new Map<string, number>();
    const t = target({ cpaMeters: 100, tcpaSeconds: -10 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, {
      previous: previousDanger(),
      recedingSince,
      nowMs: 0,
    });
    expect(r.contacts).toHaveLength(1);
    expect(r.contacts[0]).toMatchObject({
      id: 't',
      severity: 'danger',
      receding: true,
      tcpaSeconds: -10,
      source: 'provider',
    });
    expect(r.worst).toBe('danger');
    expect(recedingSince.get('t')).toBe(0);
  });

  it('drops the hold once the window lapses and sweeps the bookkeeping', () => {
    const recedingSince = new Map<string, number>([['t', 0]]);
    const t = target({ cpaMeters: 100, tcpaSeconds: -10 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, {
      previous: previousDanger(),
      recedingSince,
      nowMs: 61_000,
    });
    expect(r.contacts).toHaveLength(0);
    // Swept, and critically not re-armed on the same pass by the still populated previous map.
    expect(recedingSince.size).toBe(0);
  });

  it('never holds a contact the provider reports as past CPA beyond the window', () => {
    // A contact first seen at TCPA -90 s had its approach long ago by the provider's own clock.
    const recedingSince = new Map<string, number>();
    const t = target({ cpaMeters: 100, tcpaSeconds: -90 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, {
      previous: previousDanger(),
      recedingSince,
      nowMs: 0,
    });
    expect(r.contacts).toHaveLength(0);
    expect(recedingSince.size).toBe(0);
  });

  it('holds a computed contact that stopped closing, carrying the current range', () => {
    // Own vessel making 5 kn north; the target 111 m ahead runs away north at 10 kn, so the
    // geometry is opening and computeCpa reports the current range with a zero TCPA.
    const own = {
      position: { latitude: 0, longitude: 0 },
      sogMps: knotsToMetersPerSecond(5),
      cogRad: 0,
    };
    const t = target({
      position: { latitude: 0.001, longitude: 0 },
      sogMps: knotsToMetersPerSecond(10),
      cogRad: 0,
    });
    const recedingSince = new Map<string, number>();
    const held = assessContacts(own, [t], DEFAULT_THRESHOLDS, {
      previous: previousDanger(),
      recedingSince,
      nowMs: 1_000,
    });
    expect(held.contacts[0]).toMatchObject({
      id: 't',
      severity: 'danger',
      receding: true,
      source: 'computed',
      tcpaSeconds: 0,
    });
    expect(held.contacts[0]?.cpaMeters).toBeGreaterThan(100);
    expect(held.contacts[0]?.cpaMeters).toBeLessThan(125);

    const lapsed = assessContacts(own, [t], DEFAULT_THRESHOLDS, {
      previous: previousDanger(),
      recedingSince,
      nowMs: 62_000,
    });
    expect(lapsed.contacts).toHaveLength(0);
    expect(recedingSince.size).toBe(0);
  });

  it('clears the hold when the contact closes again', () => {
    const recedingSince = new Map<string, number>([['t', 0]]);
    const t = target({ cpaMeters: 100, tcpaSeconds: 60 });
    const r = assessContacts(ownStationary, [t], DEFAULT_THRESHOLDS, {
      previous: previousDanger(),
      recedingSince,
      nowMs: 30_000,
    });
    expect(r.contacts[0]?.receding).toBe(false);
    expect(recedingSince.has('t')).toBe(false);
  });

  it('sorts a receding contact after a closing one of the same grade', () => {
    const closing = target({ id: 'closing', cpaMeters: 100, tcpaSeconds: 60 });
    const past = target({ id: 'past', cpaMeters: 100, tcpaSeconds: -5 });
    const r = assessContacts(ownStationary, [past, closing], DEFAULT_THRESHOLDS, {
      previous: new Map<string, 'danger'>([['past', 'danger']]),
      recedingSince: new Map(),
      nowMs: 0,
    });
    expect(r.contacts.map((c) => c.id)).toEqual(['closing', 'past']);
    expect(r.contacts.map((c) => c.severity)).toEqual(['danger', 'danger']);
  });
});

describe('assessContacts nearest unassessed', () => {
  it('ranges the nearest unassessed contact from a fresh own fix', () => {
    // Both lack motion data, so both grade motion-unknown; only the closer one is reported.
    const near = target({ id: 'near', name: 'Ghost', position: { latitude: 0.01, longitude: 0 } });
    const far = target({ id: 'far', position: { latitude: 0.02, longitude: 0 } });
    const r = assessContacts(ownStationary, [far, near], DEFAULT_THRESHOLDS);
    expect(r.unassessed).toHaveLength(2);
    expect(r.nearestUnassessed?.id).toBe('near');
    expect(r.nearestUnassessed?.name).toBe('Ghost');
    expect(r.nearestUnassessed?.rangeMeters).toBeGreaterThan(1100);
    expect(r.nearestUnassessed?.rangeMeters).toBeLessThan(1125);
  });

  it('ranges own-fix-lost contacts from a fresh position when only the own motion is stale', () => {
    const t = target({ position: { latitude: 1852 / 111320, longitude: 0 } });
    const r = assessContacts(undefined, [t], DEFAULT_THRESHOLDS, {
      ownPosition: { latitude: 0, longitude: 0 },
    });
    expect(r.unassessed[0]?.reason).toBe('own-fix-lost');
    expect(r.nearestUnassessed?.id).toBe('t');
    expect(r.nearestUnassessed?.rangeMeters).toBeGreaterThan(1840);
    expect(r.nearestUnassessed?.rangeMeters).toBeLessThan(1860);
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
    let now = 0;
    const collision = new CollisionAssessment(
      new OwnVessel(store),
      new AisTargets(store),
      createThresholds(),
      () => false,
      () => now,
    );
    collision.acknowledge();
    expect(collision.suppressed).toBe(true);

    // The contact opens (negative TCPA). It holds through the receding window at its acknowledged
    // grade, so the acknowledge keeps suppressing it rather than treating the pass as a new event.
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
    expect(collision.assessment.contacts[0]?.receding).toBe(true);
    expect(collision.suppressed).toBe(true);

    // Past the hold window the assessment goes all-clear.
    now = 61_000;
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([
            ['navigation.closestApproach', { distance: 120, timeTo: -20 }],
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

  it('stops escalating once the contact is receding, even inside the inner ring', () => {
    // A 100 m pass just completed: still listed as a receding danger through the hold window, but
    // nothing is imminent any more, so the mute and acknowledge override must end.
    const store = dangerStore('vessels.a');
    const collision = new CollisionAssessment(
      new OwnVessel(store),
      new AisTargets(store),
      createThresholds(),
    );
    expect(collision.escalating).toBe(true);
    store.applyFrame({
      self: new Map(),
      ais: new Map([
        [
          'vessels.a',
          new Map<string, unknown>([['navigation.closestApproach', { distance: 100, timeTo: -5 }]]),
        ],
      ]),
      connection: { phase: 'open', attempt: 0 },
      epoch: Date.now(),
    });
    expect(collision.assessment.contacts[0]?.receding).toBe(true);
    expect(collision.assessment.worst).toBe('danger');
    expect(collision.escalating).toBe(false);
  });
});

describe('CollisionAssessment own-vessel freshness', () => {
  it('degrades computed CPA to visible own-fix-lost when own motion is stale', () => {
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

    // No computed contact, but no silent drop either: the target reads own-fix-lost, and the
    // still fresh position ranges it (about 1 nm north).
    expect(collision.assessment.contacts).toHaveLength(0);
    expect(collision.assessment.ownFixLost).toBe(true);
    expect(collision.assessment.unassessed).toEqual([
      {
        id: 'vessels.closing',
        name: undefined,
        position: { latitude: 1852 / 111320, longitude: 0 },
        reason: 'own-fix-lost',
      },
    ]);
    expect(collision.assessment.nearestUnassessed?.id).toBe('vessels.closing');
    expect(collision.assessment.nearestUnassessed?.rangeMeters).toBeGreaterThan(1840);
    expect(collision.assessment.nearestUnassessed?.rangeMeters).toBeLessThan(1860);
  });
});

describe('CollisionAssessment radar contacts', () => {
  const radarContact = (partial: Partial<CollisionContact> = {}): CollisionContact => ({
    id: 'radar:r1:7',
    name: 'Radar 7',
    position: { latitude: 0.008, longitude: 0 },
    ...partial,
  });

  it('merges radar contacts with AIS through the same thresholds, ids namespaced apart', () => {
    const store = dangerStore('vessels.a');
    const collision = new CollisionAssessment(
      new OwnVessel(store),
      new AisTargets(store),
      createThresholds(),
      () => false,
      () => 0,
      () => [radarContact({ cpaMeters: 100, tcpaSeconds: 90 })],
    );
    const contacts = collision.assessment.contacts;
    expect(contacts.map((c) => c.id)).toEqual(['vessels.a', 'radar:r1:7']);
    const radar = contacts[1];
    expect(radar?.name).toBe('Radar 7');
    expect(radar?.severity).toBe('danger');
    expect(radar?.source).toBe('provider');
  });

  it('grades a radar contact with motion but no provider cpa through the computed branch', () => {
    // About 1113 m due north of the stationary own vessel, running due south at 5 m/s: CPA near
    // zero, TCPA about 222 s, danger under the defaults.
    const contact = radarContact({
      position: { latitude: 0.01, longitude: 0 },
      sogMps: 5,
      cogRad: Math.PI,
    });
    const r = assessContacts(ownStationary, [contact], DEFAULT_THRESHOLDS);
    expect(r.contacts[0]?.id).toBe('radar:r1:7');
    expect(r.contacts[0]?.severity).toBe('danger');
    expect(r.contacts[0]?.source).toBe('computed');
  });

  it('grades a radar contact without motion as unassessed, never clear', () => {
    // An acquiring ARPA target whose motion estimate has not converged carries no course or speed.
    const r = assessContacts(ownStationary, [radarContact()], DEFAULT_THRESHOLDS);
    expect(r.contacts).toHaveLength(0);
    expect(r.unassessed).toEqual([
      {
        id: 'radar:r1:7',
        name: 'Radar 7',
        position: { latitude: 0.008, longitude: 0 },
        reason: 'motion-unknown',
      },
    ]);
  });

  it('applies the receding hold to a radar contact whose approach passes', () => {
    let now = 0;
    let contact = radarContact({ cpaMeters: 100, tcpaSeconds: 60 });
    const store = new SignalKStore();
    const collision = new CollisionAssessment(
      new OwnVessel(store),
      new AisTargets(store),
      createThresholds(),
      () => false,
      () => now,
      () => [contact],
    );
    expect(collision.assessment.contacts[0]?.severity).toBe('danger');
    expect(collision.assessment.contacts[0]?.receding).toBe(false);

    // The approach passes: the contact holds at its prior grade instead of vanishing at CPA.
    contact = radarContact({ cpaMeters: 100, tcpaSeconds: -5 });
    expect(collision.assessment.contacts[0]?.severity).toBe('danger');
    expect(collision.assessment.contacts[0]?.receding).toBe(true);

    // Past the hold window the opening contact drops.
    now += 61_000;
    expect(collision.assessment.contacts).toHaveLength(0);
  });

  it('reads all-clear when the radar source is empty and no AIS traffic exists', () => {
    const store = new SignalKStore();
    const collision = new CollisionAssessment(
      new OwnVessel(store),
      new AisTargets(store),
      createThresholds(),
    );
    expect(collision.assessment.contacts).toHaveLength(0);
    expect(collision.assessment.worst).toBe('clear');
  });
});

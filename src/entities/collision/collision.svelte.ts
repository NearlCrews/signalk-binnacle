import type { AisTargets, AisTargetView } from '$entities/ais';
import type { OwnVessel } from '$entities/vessel';
import type { LatLon } from '$shared/geo';
import { isFiniteNumber, knotsToMetersPerSecond } from '$shared/lib';
import { computeCpa, haversineMeters } from '$shared/nav';
import type { PersistedValue, Thresholds } from '$shared/settings';

export type Severity = 'danger' | 'warning' | 'clear';
// A contact only enters the danger list once it is past 'clear', so its severity is always one of
// the two active grades. The full Severity stays on Assessment.worst, which can read 'clear'.
export type ActiveSeverity = Exclude<Severity, 'clear'>;
type CpaSource = 'provider' | 'computed';

export interface DangerContact {
  id: string;
  name?: string;
  position: LatLon;
  cpaMeters: number;
  tcpaSeconds: number;
  severity: ActiveSeverity;
  source: CpaSource;
  // True once the closest approach has passed: the contact is held at its last active grade for a
  // bounded window so it does not vanish from displays at the very moment the vessels are nearest.
  // Displays render "past closest approach" instead of a countdown; tcpaSeconds is the provider's
  // time past CPA (at or below zero) or zero on the computed branch, whose cpaMeters is the
  // current range. Optional so hand-built fixtures elsewhere stay valid: absent reads as false,
  // and the assessment itself always writes it.
  receding?: boolean;
}

// A data-quality state, not a danger severity: the target is retained and may be moving, but its
// closest approach cannot be computed honestly, so it must never read as clear. 'own-fix-lost'
// means the degradation is the own vessel's: with the own fix lost or stale, every target needing
// locally computed geometry is unassessable regardless of its own data quality.
export type UnassessedReason = 'course-unavailable' | 'motion-unknown' | 'own-fix-lost';

export interface UnassessedContact {
  id: string;
  name?: string;
  position: LatLon;
  reason: UnassessedReason;
}

export interface NearestUnassessed {
  id: string;
  name?: string;
  rangeMeters: number;
}

export interface Assessment {
  contacts: DangerContact[];
  worst: Severity;
  unassessed: UnassessedContact[];
  // True when the own fix is lost or stale while targets needing locally computed geometry are
  // present: every such target grades unassessed with reason 'own-fix-lost'. Consumers can say why
  // the lookout is degraded instead of reading healthy over silently dropped contacts. Optional so
  // hand-built fixtures elsewhere stay valid: absent reads as false, and the assessment itself
  // always writes it.
  ownFixLost?: boolean;
  // The closest unassessed contact, ranged from the freshest own position, so a display can state
  // how close the nearest unknown is rather than only how many exist. Absent when nothing is
  // unassessed or when no fresh own position exists to range from.
  nearestUnassessed?: NearestUnassessed;
}

interface OwnFix {
  position: LatLon;
  sogMps: number;
  cogRad: number;
}

const SEVERITY_RANK: Record<Severity, number> = { danger: 0, warning: 1, clear: 2 };

// A hard inner ring. A danger contact closer than this, and closing within this time, is an
// emergency that overrides both mute and acknowledge so the alarm sounds regardless. These are fixed
// safety floors, not the user thresholds, so a generously wide threshold setting can never silence a
// genuinely close, imminent contact.
const ESCALATE_CPA_METERS = 185; // about 0.1 nm
const ESCALATE_TCPA_SECONDS = 120;

// A target slower than this is a moored or swinging boat, not a vessel making way. When the own
// vessel is also near stationary (anchored, or under this same speed), such a target is the
// busy-marina and at-anchor nuisance the alarm must not fire on; a genuinely moving target, or own
// vessel underway toward a slow target, still alarms. One knot.
const SLOW_TARGET_SOG_MPS = knotsToMetersPerSecond(1);

// Severity is sticky on the way down: an upgrade applies immediately (an escalation is never
// delayed), but a downgrade only happens once the value clears its old band by this margin, so GPS
// scatter right at a threshold cannot flap the tone off and on or bust an acknowledge.
const DOWNGRADE_MARGIN = 1.1;

// How long a contact that graded warning or danger stays listed after its closest approach passes,
// flagged receding. Without the hold a danger contact vanishes from every display at the instant of
// CPA, while the other vessel is at its nearest; past the window an opening contact drops as before.
const RECEDING_HOLD_MS = 60_000;

// The identity-stable all-clear result: empty water yields this same object every pass, so
// consumers that dirty-check the assessment by reference (the chart overlay does, every animation
// frame) see no change instead of a fresh empty object per own-fix tick.
const EMPTY_ASSESSMENT: Assessment = {
  contacts: [],
  worst: 'clear',
  unassessed: [],
  ownFixLost: false,
};
Object.freeze(EMPTY_ASSESSMENT);
Object.freeze(EMPTY_ASSESSMENT.contacts);
Object.freeze(EMPTY_ASSESSMENT.unassessed);

// The Signal K navigation.state values that justify treating a target with no fresh speed as
// genuinely stationary rather than unassessed.
const STATIONARY_NAV_STATES = new Set(['anchored', 'moored', 'aground']);

function immediateSeverity(cpaMeters: number, tcpaSeconds: number, t: Thresholds): Severity {
  if (cpaMeters <= t.dangerCpaMeters && tcpaSeconds <= t.dangerTcpaSeconds) return 'danger';
  if (cpaMeters <= t.warningCpaMeters && tcpaSeconds <= t.warningTcpaSeconds) return 'warning';
  return 'clear';
}

function classify(
  cpaMeters: number,
  tcpaSeconds: number,
  t: Thresholds,
  previous?: Severity,
): Severity {
  const immediate = immediateSeverity(cpaMeters, tcpaSeconds, t);
  if (previous === undefined || SEVERITY_RANK[immediate] <= SEVERITY_RANK[previous]) {
    return immediate;
  }
  if (
    previous === 'danger' &&
    cpaMeters <= t.dangerCpaMeters * DOWNGRADE_MARGIN &&
    tcpaSeconds <= t.dangerTcpaSeconds * DOWNGRADE_MARGIN
  ) {
    return 'danger';
  }
  // Reached from previous danger as well as previous warning: a danger contact that has drifted
  // outside the danger margin but still sits inside the warning margin steps down one level
  // rather than snapping straight to clear.
  if (
    cpaMeters <= t.warningCpaMeters * DOWNGRADE_MARGIN &&
    tcpaSeconds <= t.warningTcpaSeconds * DOWNGRADE_MARGIN
  ) {
    return 'warning';
  }
  return immediate;
}

interface AssessOptions {
  // Contact severities from the previous pass, feeding the downgrade hysteresis and the post-CPA
  // hold: only a contact that already graded warning or danger is held once it stops closing.
  previous?: ReadonlyMap<string, Severity>;
  anchored?: boolean;
  // A fresh own position supplied separately from the full fix, because ranging the unassessed
  // needs no own motion: a fresh position with stale SOG or COG still ranges.
  ownPosition?: LatLon;
  // Post-CPA hold bookkeeping (contact id to the clock time its approach was first seen past),
  // owned by the caller and mutated here so the hold persists across passes. Entries are swept once
  // expired, so the map stays bounded even for targets that leave the list entirely.
  recedingSince?: Map<string, number>;
  nowMs?: number;
}

// The last active grade to hold a no-longer-closing contact at, or undefined when it drops. An
// entry found expired is left un-emitted rather than deleted here: deleting would let the still
// populated previous map restart the hold on the same pass. The caller's post-loop sweep removes it,
// and by the next pass the contact is out of previous, so the hold cannot re-arm until the target
// genuinely closes again.
function holdSeverity(
  id: string,
  previous: ReadonlyMap<string, Severity> | undefined,
  recedingSince: Map<string, number> | undefined,
  nowMs: number,
): ActiveSeverity | undefined {
  if (!recedingSince) return undefined;
  const prior = previous?.get(id);
  if (prior === undefined || prior === 'clear') return undefined;
  const since = recedingSince.get(id);
  if (since === undefined) {
    recedingSince.set(id, nowMs);
    return prior;
  }
  return nowMs - since <= RECEDING_HOLD_MS ? prior : undefined;
}

export function assessContacts(
  own: OwnFix | undefined,
  targets: AisTargetView[],
  thresholds: Thresholds,
  options: AssessOptions = {},
): Assessment {
  const { previous, anchored = false, recedingSince, nowMs = 0 } = options;
  const ownK = own
    ? {
        latitude: own.position.latitude,
        longitude: own.position.longitude,
        sogMps: own.sogMps,
        cogRad: own.cogRad,
      }
    : undefined;
  const contacts: DangerContact[] = [];
  const unassessed: UnassessedContact[] = [];
  let ownFixLost = false;
  for (const t of targets) {
    let cpaMeters: number;
    let tcpaSeconds: number;
    let source: CpaSource;
    if (isFiniteNumber(t.cpaMeters) && t.cpaMeters >= 0 && isFiniteNumber(t.tcpaSeconds)) {
      // A TCPA at or below zero means the closest approach is now or already past, so the
      // target is no longer closing and is not a danger even at a small CPA. This matches the
      // computed branch, which also treats tcpa <= 0 as not closing, so the two CPA sources
      // apply the same gate. A contact that already graded warning or danger is held past that
      // gate for the receding window; the provider's own TCPA bounds the window too, so a
      // contact first seen long past its approach never enters the hold.
      if (t.tcpaSeconds <= 0) {
        const held =
          t.tcpaSeconds > -RECEDING_HOLD_MS / 1000
            ? holdSeverity(t.id, previous, recedingSince, nowMs)
            : undefined;
        if (held !== undefined) {
          contacts.push({
            id: t.id,
            name: t.name,
            position: t.position,
            cpaMeters: t.cpaMeters,
            tcpaSeconds: t.tcpaSeconds,
            severity: held,
            source: 'provider',
            receding: true,
          });
        }
        continue;
      }
      cpaMeters = t.cpaMeters;
      tcpaSeconds = t.tcpaSeconds;
      source = 'provider';
    } else {
      // Computing CPA needs a live own fix; the provider branch above does not (its CPA and TCPA
      // come from the server), so a lost fix degrades only the locally computed geometry. It must
      // degrade visibly: silently dropping these contacts would leave every AIS display reading
      // healthy while the lookout is blind, so each one grades unassessed instead.
      if (!ownK) {
        ownFixLost = true;
        unassessed.push({
          id: t.id,
          name: t.name,
          position: t.position,
          reason: 'own-fix-lost',
        });
        continue;
      }
      // Both motion fields arrive through the AIS freshness window, so undefined means missing or
      // expired. Never fabricate a track: a target without fresh speed is stationary only when its
      // reported navigation state says so, and a moving target without a fresh course cannot be
      // assessed at all. Unassessed is a data-quality outcome, never a danger and never clear.
      const sog = t.sogMps;
      const cog = t.cogRad;
      if (sog === undefined) {
        if (!STATIONARY_NAV_STATES.has(t.navigationState ?? '')) {
          unassessed.push({
            id: t.id,
            name: t.name,
            position: t.position,
            reason: 'motion-unknown',
          });
        }
        continue;
      }
      const targetSlow = sog < SLOW_TARGET_SOG_MPS;
      if (!targetSlow && cog === undefined) {
        unassessed.push({
          id: t.id,
          name: t.name,
          position: t.position,
          reason: 'course-unavailable',
        });
        continue;
      }
      // The busy-marina and at-anchor false-alarm case: a near-stationary target (a moored or
      // swinging boat) is not a collision risk to an own vessel that is itself not making way. Own
      // vessel counts as stationary when anchored, so GPS wander at anchor cannot reinstate the
      // noise. This gate is computed-branch only: a provider's CPA and TCPA are left authoritative.
      const ownStationary = anchored || ownK.sogMps < SLOW_TARGET_SOG_MPS;
      if (ownStationary && targetSlow) continue;
      const r = computeCpa(ownK, {
        latitude: t.position.latitude,
        longitude: t.position.longitude,
        sogMps: sog,
        // A near-stationary target's course is geometrically negligible, so the fallback cannot
        // fabricate closing geometry; a moving target never reaches here without a fresh course.
        cogRad: cog ?? 0,
      });
      if (!r.closing) {
        const held = holdSeverity(t.id, previous, recedingSince, nowMs);
        if (held !== undefined) {
          // computeCpa reports the current range and a zero TCPA once the approach is past;
          // receding is what tells displays to render "past closest approach", not the numbers.
          contacts.push({
            id: t.id,
            name: t.name,
            position: t.position,
            cpaMeters: r.cpaMeters,
            tcpaSeconds: r.tcpaSeconds,
            severity: held,
            source: 'computed',
            receding: true,
          });
        }
        continue;
      }
      cpaMeters = r.cpaMeters;
      tcpaSeconds = r.tcpaSeconds;
      source = 'computed';
    }
    // A closing contact ends any receding hold, so a target that turns back in starts a fresh
    // window the next time its approach passes.
    recedingSince?.delete(t.id);
    const severity = classify(cpaMeters, tcpaSeconds, thresholds, previous?.get(t.id));
    if (severity === 'clear') continue;
    contacts.push({
      id: t.id,
      name: t.name,
      position: t.position,
      cpaMeters,
      tcpaSeconds,
      severity,
      source,
      receding: false,
    });
  }
  if (recedingSince) {
    for (const [id, since] of recedingSince) {
      if (nowMs - since > RECEDING_HOLD_MS) recedingSince.delete(id);
    }
  }
  if (contacts.length === 0 && unassessed.length === 0) return EMPTY_ASSESSMENT;
  contacts.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    // A contact still closing outranks a receding one of the same grade. Among receding provider
    // contacts the TCPA counts down past zero, so descending order puts the most recently passed
    // first (the computed branch holds a constant zero there).
    if (a.receding !== b.receding) return a.receding ? 1 : -1;
    return a.receding ? b.tcpaSeconds - a.tcpaSeconds : a.tcpaSeconds - b.tcpaSeconds;
  });
  let nearestUnassessed: NearestUnassessed | undefined;
  const origin = own?.position ?? options.ownPosition;
  if (origin && unassessed.length > 0) {
    let bestMeters = Number.POSITIVE_INFINITY;
    let best: UnassessedContact | undefined;
    for (const u of unassessed) {
      const meters = haversineMeters(
        origin.latitude,
        origin.longitude,
        u.position.latitude,
        u.position.longitude,
      );
      if (meters < bestMeters) {
        bestMeters = meters;
        best = u;
      }
    }
    if (best) nearestUnassessed = { id: best.id, name: best.name, rangeMeters: bestMeters };
  }
  return {
    contacts,
    worst: contacts[0]?.severity ?? 'clear',
    unassessed,
    ownFixLost,
    nearestUnassessed,
  };
}

export class CollisionAssessment {
  #vessel: OwnVessel;
  #targets: AisTargets;
  #thresholds: PersistedValue<Thresholds>;
  // Reads anchor-watch state so an anchored own vessel treats moored and swinging boats as the
  // non-hazards they are, silencing the busy-anchorage nuisance. A callback, not the anchor entity,
  // keeps this entity from importing a sibling and lets the composition root wire the dependency.
  #anchored: () => boolean;

  // The worst-contact signature (id and severity) that was acknowledged. The alert is
  // suppressed only while the current worst contact still matches it, so a new or more
  // severe contact re-arms the alert automatically. Held as fields rather than a joined
  // string so suppressed, read every animation frame, allocates nothing. Full mute
  // lifecycle is Lookout step 4.
  #ackSignature = $state<{ id: string; severity: ActiveSeverity } | null>(null);

  // Set during the assessment recompute when the situation goes all-clear, so the same vessel
  // re-approaching later at the same severity is a new event, never auto-suppressed by a stale
  // acknowledge. A plain field, not $state: it is written inside the $derived recompute, where
  // reactive writes are forbidden, and the assessment change itself re-runs every suppressed
  // reader anyway.
  #ackExpired = false;

  // Contact severities from the previous pass, feeding the downgrade hysteresis in classify.
  // A plain field for the same reason as #ackExpired.
  #lastSeverities: Map<string, Severity> | undefined;

  // Post-CPA hold bookkeeping, mutated inside assessContacts. Long-lived and swept there, so a pass
  // allocates no fresh map. The injected #now is deliberately non-reactive (the Date.now style
  // AisTargets uses): a reactive clock read here would recompute the whole CPA loop every tick and
  // break the assessment's identity stability. An expired hold is therefore observed on the next
  // real recompute (AIS traffic or an own-fix change), which live AIS updates and the AIS prune
  // timer provide within seconds.
  #recedingSince = new Map<string, number>();
  #now: () => number;

  // Memoized so the O(targets) CPA loop runs once per real change, not once per read. The
  // assessment is read several times per frame (alarm, notifier, danger strip, overlay), and
  // the overlay reads it every animation frame; $derived recomputes only when traffic, the
  // own fix, or the thresholds actually change. The version read tracks the non-reactive Map.
  #assessment = $derived.by<Assessment>(() => {
    void this.#targets.version;
    const position = this.#vessel.position;
    // A stale own fix is treated as no fix: computing CPA and TCPA against a position the boat
    // left minutes ago would alarm (or fail to alarm) on geometry that no longer exists. Only the
    // locally computed branch degrades for it (to visibly unassessed contacts, not a silent drop);
    // provider-sourced contacts keep alarming, since their CPA and TCPA come from the server and
    // need no local fix. The fresh position rides along separately so the unassessed can still be
    // ranged when only the own motion is stale.
    const freshPosition = position && !this.#vessel.positionStale ? position : undefined;
    const sogMps = this.#vessel.sogMps;
    const cogRad = this.#vessel.cogRad;
    const own =
      freshPosition &&
      sogMps !== undefined &&
      !this.#vessel.sogStale &&
      cogRad !== undefined &&
      !this.#vessel.cogStale
        ? { position: freshPosition, sogMps, cogRad }
        : undefined;
    const next = assessContacts(own, this.#targets.list(), this.#thresholds.value, {
      previous: this.#lastSeverities,
      anchored: this.#anchored(),
      ownPosition: freshPosition,
      recedingSince: this.#recedingSince,
      nowMs: this.#now(),
    });
    if (next.contacts.length === 0) {
      this.#lastSeverities = undefined;
      this.#ackExpired = true;
    } else {
      const severities = new Map<string, Severity>();
      for (const c of next.contacts) severities.set(c.id, c.severity);
      this.#lastSeverities = severities;
    }
    return next;
  });

  constructor(
    vessel: OwnVessel,
    targets: AisTargets,
    thresholds: PersistedValue<Thresholds>,
    anchored: () => boolean = () => false,
    now: () => number = Date.now,
  ) {
    this.#vessel = vessel;
    this.#targets = targets;
    this.#thresholds = thresholds;
    this.#anchored = anchored;
    this.#now = now;
  }

  get assessment(): Assessment {
    return this.#assessment;
  }

  // True when the current worst contact has been acknowledged and has not since changed or
  // gone clear in between.
  get suppressed(): boolean {
    const top = this.#topContact;
    const ack = this.#ackSignature;
    return (
      top !== undefined &&
      ack !== null &&
      !this.#ackExpired &&
      top.id === ack.id &&
      top.severity === ack.severity
    );
  }

  // True when the worst contact is inside the hard inner ring: close enough and imminent enough that
  // the alarm must sound even if muted or acknowledged. Consumers use it to override suppression.
  // A receding contact never escalates: its approach is past, so nothing is imminent, and its TCPA
  // (zero or negative during the hold) would otherwise read as inside the ring.
  get escalating(): boolean {
    const top = this.#topContact;
    return (
      !!top &&
      !top.receding &&
      top.severity === 'danger' &&
      top.cpaMeters <= ESCALATE_CPA_METERS &&
      top.tcpaSeconds <= ESCALATE_TCPA_SECONDS
    );
  }

  acknowledge(): void {
    this.#ackExpired = false;
    const top = this.#topContact;
    this.#ackSignature = top ? { id: top.id, severity: top.severity } : null;
  }

  get #topContact(): DangerContact | undefined {
    return this.#assessment.contacts[0];
  }
}

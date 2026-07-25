import type { AisTargets, AisTargetView } from '$entities/ais';
import type { OwnVessel } from '$entities/vessel';
import type { LatLon } from '$shared/geo';
import { isFiniteNumber, knotsToMetersPerSecond } from '$shared/lib';
import { computeCpa } from '$shared/nav';
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
}

export interface Assessment {
  contacts: DangerContact[];
  worst: Severity;
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

// The identity-stable all-clear result: empty water yields this same object every pass, so
// consumers that dirty-check the assessment by reference (the chart overlay does, every animation
// frame) see no change instead of a fresh empty object per own-fix tick.
const EMPTY_ASSESSMENT: Assessment = { contacts: [], worst: 'clear' };
Object.freeze(EMPTY_ASSESSMENT);
Object.freeze(EMPTY_ASSESSMENT.contacts);

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

export function assessContacts(
  own: OwnFix | undefined,
  targets: AisTargetView[],
  thresholds: Thresholds,
  previous?: ReadonlyMap<string, Severity>,
  anchored = false,
): Assessment {
  const ownK = own
    ? {
        latitude: own.position.latitude,
        longitude: own.position.longitude,
        sogMps: own.sogMps,
        cogRad: own.cogRad,
      }
    : undefined;
  const contacts: DangerContact[] = [];
  for (const t of targets) {
    let cpaMeters: number;
    let tcpaSeconds: number;
    let source: CpaSource;
    if (isFiniteNumber(t.cpaMeters) && t.cpaMeters >= 0 && isFiniteNumber(t.tcpaSeconds)) {
      // A TCPA at or below zero means the closest approach is now or already past, so the
      // target is no longer closing and is not a danger even at a small CPA. This matches the
      // computed branch, which also treats tcpa <= 0 as not closing, so the two CPA sources
      // apply the same gate.
      if (t.tcpaSeconds <= 0) continue;
      cpaMeters = t.cpaMeters;
      tcpaSeconds = t.tcpaSeconds;
      source = 'provider';
    } else {
      // Computing CPA needs a live own fix; the provider branch above does not (its CPA and TCPA
      // come from the server), so a lost fix stands down only the locally computed geometry.
      if (!ownK) continue;
      // A reported SOG with no COG has no usable track; defaulting the course to due north would
      // fabricate closing geometry, so such a target counts as stationary instead.
      const targetSogMps = t.cogRad === undefined ? 0 : (t.sogMps ?? 0);
      // The busy-marina and at-anchor false-alarm case: a near-stationary target (a moored or
      // swinging boat) is not a collision risk to an own vessel that is itself not making way. Own
      // vessel counts as stationary when anchored, so GPS wander at anchor cannot reinstate the
      // noise. This gate is computed-branch only: a provider's CPA and TCPA are left authoritative.
      const ownStationary = anchored || ownK.sogMps < SLOW_TARGET_SOG_MPS;
      if (ownStationary && targetSogMps < SLOW_TARGET_SOG_MPS) continue;
      const r = computeCpa(ownK, {
        latitude: t.position.latitude,
        longitude: t.position.longitude,
        sogMps: targetSogMps,
        cogRad: t.cogRad ?? 0,
      });
      if (!r.closing) continue;
      cpaMeters = r.cpaMeters;
      tcpaSeconds = r.tcpaSeconds;
      source = 'computed';
    }
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
    });
  }
  if (contacts.length === 0) return EMPTY_ASSESSMENT;
  contacts.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.tcpaSeconds - b.tcpaSeconds,
  );
  return { contacts, worst: contacts[0].severity };
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

  // Memoized so the O(targets) CPA loop runs once per real change, not once per read. The
  // assessment is read several times per frame (alarm, notifier, danger strip, overlay), and
  // the overlay reads it every animation frame; $derived recomputes only when traffic, the
  // own fix, or the thresholds actually change. The version read tracks the non-reactive Map.
  #assessment = $derived.by<Assessment>(() => {
    void this.#targets.version;
    const position = this.#vessel.position;
    // A stale own fix is treated as no fix: computing CPA and TCPA against a position the boat
    // left minutes ago would alarm (or fail to alarm) on geometry that no longer exists. Only the
    // locally computed branch stands down for it; provider-sourced contacts keep alarming, since
    // their CPA and TCPA come from the server and need no local fix.
    const sogMps = this.#vessel.sogMps;
    const cogRad = this.#vessel.cogRad;
    const own =
      position &&
      !this.#vessel.positionStale &&
      sogMps !== undefined &&
      !this.#vessel.sogStale &&
      cogRad !== undefined &&
      !this.#vessel.cogStale
        ? { position, sogMps, cogRad }
        : undefined;
    const next = assessContacts(
      own,
      this.#targets.list(),
      this.#thresholds.value,
      this.#lastSeverities,
      this.#anchored(),
    );
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
  ) {
    this.#vessel = vessel;
    this.#targets = targets;
    this.#thresholds = thresholds;
    this.#anchored = anchored;
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
  get escalating(): boolean {
    const top = this.#topContact;
    return (
      !!top &&
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

import type { OwnVessel } from '$entities/vessel';
import { asNumber, isLatLon, type LatLon } from '$shared/geo';
import { HeldFlag, isFiniteNumber, isRecord, type ReactiveClock } from '$shared/lib';
import { haversineMeters } from '$shared/nav';
import { binnacleStorageKey } from '$shared/persistence';
import {
  boundedNumberPersistedCodec,
  type PersistedCodec,
  PersistedValue,
  type StorageLike,
} from '$shared/settings';
import {
  isSoundingNotification,
  notificationState,
  type SignalKStore,
  SK_PATHS,
} from '$shared/signalk';
import { DEFAULT_RADIUS_M, MIN_RADIUS_M } from './anchor-geometry';
import { DragDetector } from './drag-detector';

// 'server' when the signalk-anchoralarm-plugin is watching (its navigation.anchor.position is on the
// stream), 'client' when this browser watches on its own, 'off' when no anchor is down.
export type AnchorMode = 'off' | 'client' | 'server';

// Why the watch is degraded: 'fix-lost' is a client watch whose drag detection is dead without
// position fixes, 'server-stale' a reconnect window where retained server geometry cannot be
// trusted as current.
export type AnchorDegradedCause = 'fix-lost' | 'server-stale';

// How long server-state staleness must persist before it is reported as a cause: the worker bumps
// the store generation on every socket open, so each reconnect reads as stale for the sub-second
// window until the resubscribed anchor cells re-arrive, and reporting that blip would raise a
// false alert on every reconnect. Without a clock the cause reports immediately.
const SERVER_STALE_GRACE_MS = 5_000;

// How long a client watch must run without a fix before the audible alarm joins the visual
// surfaces: drag detection is dead the whole time, but GPS blips of a few seconds are routine at
// anchor and a tone for each would train the crew to ignore the channel.
const FIX_LOST_ALARM_GRACE_MS = 30_000;
// A fix-lost episode ends only after the fix has stayed healthy this long. A single returning
// fix must not restart the alarm grace or forget an acknowledgment: with a fix cadence between
// the 10 s staleness threshold and 40 s, a per-fix reset would keep the grace permanently below
// its threshold.
const FIX_RECOVERY_HOLD_MS = 30_000;

// The client-side watch persisted across reloads. dragging is part of it on purpose: an alarm that
// a reload could clear while the navigator sleeps is useless.
export interface LocalAnchor {
  position: LatLon;
  radiusMeters: number;
  dragging: boolean;
}

const MAX_ANCHOR_RADIUS_M = 1_000_000;

function clampRadius(radiusMeters: number): number {
  return Math.min(MAX_ANCHOR_RADIUS_M, Math.max(MIN_RADIUS_M, radiusMeters));
}

function validLocal(value: unknown): LocalAnchor | null {
  if (!isRecord(value)) return null;
  if (!isLatLon(value.position)) return null;
  if (
    !isFiniteNumber(value.radiusMeters) ||
    value.radiusMeters < MIN_RADIUS_M ||
    value.radiusMeters > MAX_ANCHOR_RADIUS_M
  ) {
    return null;
  }
  // Rebuilt as a clean literal: spreading the raw localStorage object would re-persist any
  // unknown extra properties forever.
  return {
    position: { latitude: value.position.latitude, longitude: value.position.longitude },
    radiusMeters: value.radiusMeters,
    dragging: value.dragging === true,
  };
}

const localAnchorCodec: PersistedCodec<LocalAnchor | null> = {
  decode(value) {
    if (value === null) return { state: 'valid', value: null };
    const clean = validLocal(value);
    if (!clean || !isRecord(value) || !isRecord(value.position)) return { state: 'invalid' };
    const exactShape =
      Object.keys(value).length === 3 &&
      Object.keys(value.position).length === 2 &&
      typeof value.dragging === 'boolean';
    return { state: exactShape ? 'valid' : 'migrated', value: clean };
  },
};

// The anchor watch state machine. Server mode is fully stream-driven: the plugin's
// navigation.anchor.position and maxRadius cells are the source of truth, and its
// notifications.navigation.anchor grades the drag alarm; nothing server-side is persisted here
// because the stream restores it on the next load. Client mode is local: the drop point and radius
// live in localStorage and the drag detection runs on each position fix fed in via updateFix.
export class AnchorWatch {
  #store: SignalKStore;
  #vessel: OwnVessel;
  #clock: ReactiveClock | undefined;
  #detector = new DragDetector();
  #watch: PersistedValue<LocalAnchor | null>;
  #preferredRadius: PersistedValue<number>;
  #local = $state<LocalAnchor | null>(null);
  // The notification state string the navigator acknowledged, so the sound stays off while the
  // server keeps reporting that same grade; an escalation (a new state) sounds again.
  #ackState = $state<string | undefined>(undefined);
  // The navigator has acknowledged the current fix-lost episode; re-arms once the fix returns.
  #fixLostAcked = $state(false);
  // The server-stale grace, constructed with the clock; undefined without one.
  #staleHeld: HeldFlag | undefined;
  // Plain memo, not $state: updateFix writes it to remember when the fix-lost episode began.
  #fixLostSince: number | undefined;
  // When the fix last came back, so a fix-lost episode survives a momentary recovery. A
  // struggling receiver delivering a fix every 10 to 40 seconds would otherwise reset the alarm
  // grace on every fix and never arm the tone at all, which is exactly the receiver whose drag
  // detection is also effectively dead.
  #fixRecoveredAt: number | undefined;
  // The epoch of the last fix the detector counted. updateFix runs from a reactive effect, which
  // re-fires on any dependency (a radius edit, a notification), not only on a new fix; without this
  // guard a re-run would feed the same fix into the breach counter twice.
  #lastFixEpoch = 0;

  constructor(
    store: SignalKStore,
    vessel: OwnVessel,
    clock?: ReactiveClock,
    storage?: StorageLike,
  ) {
    this.#store = store;
    this.#vessel = vessel;
    this.#clock = clock;
    // Without a clock the stale cause reports immediately; the graced flag needs one to count.
    this.#staleHeld = clock
      ? new HeldFlag(clock, SERVER_STALE_GRACE_MS, () => this.#serverStateStale)
      : undefined;
    this.#watch = new PersistedValue<LocalAnchor | null>(
      binnacleStorageKey('anchorWatch'),
      null,
      storage,
      localAnchorCodec,
    );
    this.#preferredRadius = new PersistedValue<number>(
      binnacleStorageKey('anchorRadius'),
      DEFAULT_RADIUS_M,
      storage,
      boundedNumberPersistedCodec(MIN_RADIUS_M, MAX_ANCHOR_RADIUS_M),
    );
    this.#local = validLocal(this.#watch.value);
    // Pre-create the cells this watch reads, so the first reactive read finds a tracked cell
    // (see OwnVessel for the lazily-created-cell pitfall).
    store.ensureCells([
      SK_PATHS.anchorPosition,
      SK_PATHS.anchorMaxRadius,
      SK_PATHS.anchorNotification,
    ]);
  }

  #serverPosition = $derived.by<LatLon | undefined>(() => {
    const value = this.#currentRaw(SK_PATHS.anchorPosition);
    return isLatLon(value) ? value : undefined;
  });

  #serverRadius = $derived.by<number | undefined>(() =>
    asNumber(this.#currentRaw(SK_PATHS.anchorMaxRadius)),
  );

  #serverStateStale = $derived.by<boolean>(() => {
    const cell = this.#store.cell(SK_PATHS.anchorPosition);
    return isLatLon(cell.value) && cell.epoch > 0 && cell.generation !== this.#store.generation;
  });

  #notificationState = $derived.by<string | undefined>(() =>
    notificationState(this.#raw(SK_PATHS.anchorNotification)),
  );

  #serverDragging = $derived.by<boolean>(() =>
    isSoundingNotification(this.#raw(SK_PATHS.anchorNotification)),
  );

  get mode(): AnchorMode {
    if (this.#serverPosition || this.#serverStateStale) return 'server';
    return this.#local ? 'client' : 'off';
  }

  get watching(): boolean {
    return this.mode !== 'off';
  }

  // The watch has lost its position feed: the distance readout cannot be trusted in any mode.
  get fixLost(): boolean {
    return this.watching && (!this.#vessel.position || this.#vessel.positionStale);
  }

  // Client-mode drag detection counts position fixes, so without them it is silently dead; a
  // server watch keeps alarming on its own feed. Consumers must make this state loud: the watch
  // guards a sleeping crew.
  get degraded(): boolean {
    return this.#serverStateStale || (this.fixLost && this.mode !== 'server');
  }

  // Why the watch is degraded, for surfaces that must word the two causes differently. The
  // server-stale cause waits out a short grace so a reconnect's routine sub-second blip never
  // reaches a live region or panel; immediateDegradedCause skips the grace for surfaces that
  // must not show reassuring text over untrusted geometry, and `degraded` stays immediate too.
  get degradedCause(): AnchorDegradedCause | undefined {
    if (this.fixLost && this.mode !== 'server') return 'fix-lost';
    if (this.#staleHeld ? this.#staleHeld.held : this.#serverStateStale) return 'server-stale';
    return undefined;
  }

  // The same classification without the server-stale grace, for panels (not live regions) that
  // word the state the moment it exists.
  get immediateDegradedCause(): AnchorDegradedCause | undefined {
    if (this.fixLost && this.mode !== 'server') return 'fix-lost';
    if (this.#serverStateStale) return 'server-stale';
    return undefined;
  }

  // Per-episode bookkeeping for the fix-lost alarm, owned entirely by updateFix, which runs on
  // every reactive pass (its effect depends on the clock through degradedCause). Losing the fix
  // starts (or resumes) an episode; a recovery only ends it after holding FIX_RECOVERY_HOLD_MS,
  // or immediately when the watch itself ends, and ending the episode re-arms the acknowledge.
  #trackFixEpisode(): void {
    const now = this.#clock?.now;
    if (this.degradedCause === 'fix-lost') {
      this.#fixRecoveredAt = undefined;
      if (now !== undefined) this.#fixLostSince ??= now;
      return;
    }
    if (this.#fixLostSince === undefined || now === undefined || !this.watching) {
      this.#endFixEpisode();
      return;
    }
    this.#fixRecoveredAt ??= now;
    if (now - this.#fixRecoveredAt >= FIX_RECOVERY_HOLD_MS) this.#endFixEpisode();
  }

  #endFixEpisode(): void {
    this.#fixLostSince = undefined;
    this.#fixRecoveredAt = undefined;
    if (this.#fixLostAcked) this.#fixLostAcked = false;
  }

  // The audible half of the fix-lost degrade: the client watch has run without a fix long enough
  // that drag protection is genuinely dead, so a sleeping crew must hear about it, not read it.
  // A pure read of the episode memo updateFix maintains, so it can never write state from a
  // derived context.
  get fixLostAlarm(): boolean {
    if (this.degradedCause !== 'fix-lost') return false;
    const now = this.#clock?.now;
    if (now === undefined || this.#fixLostSince === undefined) return false;
    return now - this.#fixLostSince >= FIX_LOST_ALARM_GRACE_MS;
  }

  // True while the navigator has acknowledged the current fix-lost episode, so the tone stays off
  // until the fix returns and is lost again.
  get fixLostAcknowledged(): boolean {
    return this.#fixLostAcked && this.degradedCause === 'fix-lost';
  }

  get position(): LatLon | undefined {
    if (this.mode === 'server') return this.#serverPosition;
    return this.#local?.position;
  }

  // The active watch radius in meters, or undefined when off (or when a server watch has not
  // published its radius yet, so no circle is drawn for it).
  get radiusMeters(): number | undefined {
    if (this.mode === 'server') return this.#serverRadius;
    return this.#local?.radiusMeters;
  }

  // The radius the next drop starts from: the last radius the navigator set, on any watch.
  get preferredRadiusMeters(): number {
    return this.#preferredRadius.value;
  }

  // Live distance from the anchor to the boat, in meters. A $derived so the haversine runs once
  // per position change, not on every read (the strip, panel, chip, and detector all read it).
  #distance = $derived.by<number | undefined>(() => {
    const anchor = this.position;
    const boat = this.#vessel.position;
    if (!anchor || !boat || this.#vessel.positionStale) return undefined;
    return haversineMeters(anchor.latitude, anchor.longitude, boat.latitude, boat.longitude);
  });

  get distanceMeters(): number | undefined {
    return this.#distance;
  }

  get dragging(): boolean {
    if (this.mode === 'server') return this.#serverDragging;
    return this.#local?.dragging ?? false;
  }

  // True while the navigator has silenced the current server drag grade. Client mode never reports
  // it: there, acknowledge clears the latch outright and the strip goes with it.
  get acknowledged(): boolean {
    return (
      this.mode === 'server' &&
      this.#serverDragging &&
      this.#ackState !== undefined &&
      this.#ackState === this.#notificationState
    );
  }

  // Feed one reactive pass per position fix (and notification change). Client mode runs the drag
  // detection; server mode only reconciles local bookkeeping, since the plugin owns the alarm.
  updateFix(): void {
    // Per-episode bookkeeping lives here because this method runs on every reactive pass, so an
    // episode boundary advances even when nothing read the alarm during the healthy window; the
    // graced flag gets the same treatment for its unobserved-window memo.
    if (!this.#serverStateStale) this.#staleHeld?.reset();
    this.#trackFixEpisode();
    if (this.mode === 'server') {
      // The server watch is the source of truth: a lingering local watch would resurface as a stale
      // client watch after the server anchor is raised, so drop it.
      if (this.#local) this.#setLocal(null);
      // The acknowledge is per drag grade; once the server reports normal again, re-arm.
      if (!this.#serverDragging) this.#ackState = undefined;
      return;
    }
    this.#ackState = undefined;
    const local = this.#local;
    const distance = this.#distance;
    if (!local || distance === undefined) return;
    const epoch = this.#store.cell(SK_PATHS.position).epoch;
    if (epoch === this.#lastFixEpoch) return;
    this.#lastFixEpoch = epoch;
    if (this.#detector.update(distance > local.radiusMeters) && !local.dragging) {
      this.#setLocal({ ...local, dragging: true });
    }
  }

  // Start a client-side watch at the given drop point. Server drops go through the plugin instead
  // and arrive back via the stream.
  dropLocal(position: LatLon, radiusMeters: number = this.preferredRadiusMeters): void {
    if (!isLatLon(position) || !isFiniteNumber(radiusMeters)) return;
    this.#detector.reset();
    this.#setLocal({
      position,
      radiusMeters: clampRadius(radiusMeters),
      dragging: false,
    });
  }

  raiseLocal(): void {
    this.#detector.reset();
    this.#setLocal(null);
  }

  setRadiusLocal(radiusMeters: number): void {
    if (!isFiniteNumber(radiusMeters)) return;
    const local = this.#local;
    if (!local) return;
    // A radius change restarts the breach window so the new circle gets a fresh judgment.
    this.#detector.reset();
    this.#setLocal({ ...local, radiusMeters: clampRadius(radiusMeters) });
  }

  movePositionLocal(position: LatLon): void {
    if (!isLatLon(position)) return;
    const local = this.#local;
    if (!local) return;
    this.#detector.reset();
    this.#setLocal({ ...local, position });
  }

  // Remember the radius the navigator chose, so the next drop starts from it.
  rememberRadius(radiusMeters: number): void {
    if (!isFiniteNumber(radiusMeters)) return;
    this.#preferredRadius.set(clampRadius(radiusMeters));
  }

  // The navigator has seen the drag alarm. Client mode clears the latch (a continued drag re-latches
  // after the next breach window); server mode silences the current grade until it changes or clears.
  // A fix-lost episode is acknowledged alongside, so one press silences whatever is sounding.
  acknowledge(): void {
    // Only a sounding fix-lost alarm can be acknowledged: latching during the grace (the strip
    // and its button are visible from the first stale second) would silently disarm the tone
    // the grace is still counting toward, for the rest of the episode.
    if (this.fixLostAlarm) this.#fixLostAcked = true;
    if (this.mode === 'server') {
      this.#ackState = this.#notificationState;
      return;
    }
    this.#detector.reset();
    const local = this.#local;
    if (local?.dragging) this.#setLocal({ ...local, dragging: false });
  }

  #setLocal(next: LocalAnchor | null): void {
    this.#watch.set(next);
    this.#local = next;
  }

  #raw(path: string): unknown {
    return this.#store.cell(path).value;
  }

  #currentRaw(path: string): unknown {
    const cell = this.#store.cell(path);
    return cell.epoch > 0 && cell.generation !== this.#store.generation ? undefined : cell.value;
  }
}

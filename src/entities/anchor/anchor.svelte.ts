import type { OwnVessel } from '$entities/vessel';
import { asNumber, isLatLon, type LatLon } from '$shared/geo';
import { isFiniteNumber, isRecord } from '$shared/lib';
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
  #detector = new DragDetector();
  #watch: PersistedValue<LocalAnchor | null>;
  #preferredRadius: PersistedValue<number>;
  #local = $state<LocalAnchor | null>(null);
  // The notification state string the navigator acknowledged, so the sound stays off while the
  // server keeps reporting that same grade; an escalation (a new state) sounds again.
  #ackState = $state<string | undefined>(undefined);
  // The epoch of the last fix the detector counted. updateFix runs from a reactive effect, which
  // re-fires on any dependency (a radius edit, a notification), not only on a new fix; without this
  // guard a re-run would feed the same fix into the breach counter twice.
  #lastFixEpoch = 0;

  constructor(store: SignalKStore, vessel: OwnVessel, storage?: StorageLike) {
    this.#store = store;
    this.#vessel = vessel;
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
  acknowledge(): void {
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

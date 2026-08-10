import type { OwnVessel } from '$entities/vessel';
import { isLatLon, type LatLon } from '$shared/geo';
import { hasControlCharacters, isFiniteNumber, isRecord, type ReactiveClock } from '$shared/lib';
import { haversineMeters, rhumbBearingRad } from '$shared/nav';
import { binnacleStorageKey } from '$shared/persistence';
import { type PersistedCodec, PersistedValue, type StorageLike } from '$shared/settings';
import { isSoundingNotification, type SignalKStore, SK_PATHS } from '$shared/signalk';

const MAX_REMOTE_NOTIFICATIONS = 500;
const MAX_NOTIFICATION_ID_LENGTH = 512;

// The mark this station made: where and when the person went in. Persisted so a reload during a
// recovery cannot lose the spot. The position is optional: an MOB without a fix is still an MOB
// (the boat-wide alarm, the elapsed clock, and the crew mobilization carry value with no datum).
export interface MobMark {
  position?: LatLon;
  epochMs: number;
}

function validMark(value: unknown): MobMark | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.epochMs) || value.epochMs < 0 || value.epochMs > 8.64e15) return null;
  if (value.position !== undefined && !isLatLon(value.position)) return null;
  // Rebuilt as a clean literal: returning the raw localStorage object would re-persist any unknown
  // extra properties forever (the same hazard anchor's validLocal guards against).
  return {
    position:
      value.position === undefined
        ? undefined
        : { latitude: value.position.latitude, longitude: value.position.longitude },
    epochMs: value.epochMs,
  };
}

const mobMarkCodec: PersistedCodec<MobMark | null> = {
  decode(value) {
    if (value === null) return { state: 'valid', value: null };
    const clean = validMark(value);
    if (!clean || !isRecord(value)) return { state: 'invalid' };
    const positionExact =
      value.position === undefined ||
      (isRecord(value.position) && Object.keys(value.position).length === 2);
    const expectedKeys = value.position === undefined ? 1 : 2;
    return {
      state: Object.keys(value).length === expectedKeys && positionExact ? 'valid' : 'migrated',
      value: clean,
    };
  },
};

// Man-overboard state. A local trigger marks the vessel position and persists it; the stream's
// notifications.mob is also reflected, so an MOB raised by another station (a crew phone) raises
// the strip here, with its mark when the notification carries a position. Cancel clears only the
// local mark; a remote alarm clears when its station publishes normal.
export class MobStore {
  #store: SignalKStore;
  #vessel: OwnVessel;
  #clock: ReactiveClock | undefined;
  #persisted: PersistedValue<MobMark | null>;
  #local = $state<MobMark | null>(null);
  #localAcknowledged = $state(false);
  #remoteAcknowledgedActivations = $state<Record<string, number>>({});

  constructor(
    store: SignalKStore,
    vessel: OwnVessel,
    clock?: ReactiveClock,
    storage?: StorageLike,
  ) {
    this.#store = store;
    this.#vessel = vessel;
    this.#clock = clock;
    this.#persisted = new PersistedValue<MobMark | null>(
      binnacleStorageKey('mob'),
      null,
      storage,
      mobMarkCodec,
    );
    this.#local = validMark(this.#persisted.value);
    // Pre-create the legacy broad cell. v2 MOB notifications append their UUID to this path and are
    // discovered through the store's reactive notification mirror below.
    store.ensureCells([SK_PATHS.mobNotification]);
  }

  #remoteNotifications = $derived.by<
    Array<{
      path: string;
      value: { state?: unknown; position?: unknown; id?: unknown };
      activation: number;
    }>
  >(() => {
    void this.#store.notificationsVersion;
    const notifications = [];
    const prefix = `${SK_PATHS.mobNotification}.`;
    for (const [path, raw] of this.#store.notifications) {
      if ((path !== SK_PATHS.mobNotification && !path.startsWith(prefix)) || !isRecord(raw))
        continue;
      if (!isSoundingNotification(raw)) continue;
      notifications.push({
        path,
        value: raw as { state?: unknown; position?: unknown; id?: unknown },
        activation: this.#store.cell(path).activation,
      });
      if (notifications.length === MAX_REMOTE_NOTIFICATIONS) break;
    }
    return notifications;
  });

  #remoteActive = $derived(this.#remoteNotifications.length > 0);

  #remotePosition = $derived.by<LatLon | undefined>(() => {
    if (!this.#remoteActive) return undefined;
    for (const notification of this.#remoteNotifications) {
      if (isLatLon(notification.value.position)) return notification.value.position;
    }
    return undefined;
  });

  get active(): boolean {
    return this.#local !== null || this.#remoteActive;
  }

  // A sounding notifications.mob entry is on the stream (this station's own echo included), so the
  // boat-wide raise is known to have reached the server; false means it may have been lost.
  get remoteActive(): boolean {
    return this.#remoteActive;
  }

  // The mark to render and steer to: this station's own, or the remote one when carried.
  get position(): LatLon | undefined {
    return this.#local?.position ?? this.#remotePosition;
  }

  // When this station's mark was made: the timestamp the log and the VHF relay need, so a stressed
  // skipper never does clock arithmetic from elapsed. A remote alarm carries no reliable epoch.
  get markEpochMs(): number | undefined {
    return this.#local?.epochMs;
  }

  // Seconds since this station's trigger. A remote alarm carries no reliable epoch, so it has none.
  get elapsedSeconds(): number | undefined {
    if (!this.#clock || !this.#local) return undefined;
    return Math.max(0, (this.#clock.now - this.#local.epochMs) / 1000);
  }

  // Live bearing (radians true) and range (meters) from the boat back to the mark. A stale fix
  // yields undefined rather than frozen guidance: dashes are honest during a GPS dropout, a
  // bearing from where the boat was a minute ago is not. Matches the footer's SOG and COG.
  #guidanceFix = $derived.by<{ mark: LatLon; boat: LatLon } | undefined>(() => {
    const mark = this.position;
    const boat = this.#vessel.position;
    if (!mark || !boat || this.#vessel.positionStale) return undefined;
    return { mark, boat };
  });

  #bearing = $derived.by<number | undefined>(() => {
    const fix = this.#guidanceFix;
    if (!fix) return undefined;
    return rhumbBearingRad(fix.boat, fix.mark);
  });

  #distance = $derived.by<number | undefined>(() => {
    const fix = this.#guidanceFix;
    if (!fix) return undefined;
    return haversineMeters(
      fix.boat.latitude,
      fix.boat.longitude,
      fix.mark.latitude,
      fix.mark.longitude,
    );
  });

  get bearingRad(): number | undefined {
    return this.#bearing;
  }

  get distanceMeters(): number | undefined {
    return this.#distance;
  }

  get acknowledged(): boolean {
    if (!this.#local && !this.#remoteActive) return false;
    const localAcknowledged = !this.#local || this.#localAcknowledged;
    const remoteAcknowledged =
      !this.#remoteActive ||
      this.#remoteNotifications.every(
        ({ path, activation }) => this.#remoteAcknowledgedActivations[path] === activation,
      );
    return localAcknowledged && remoteAcknowledged;
  }

  get remoteNotificationIds(): string[] {
    const ids = new Set<string>();
    for (const { value } of this.#remoteNotifications) {
      if (typeof value.id !== 'string') continue;
      const id = value.id;
      if (
        !id ||
        id.trim() !== id ||
        id.length > MAX_NOTIFICATION_ID_LENGTH ||
        hasControlCharacters(id)
      ) {
        continue;
      }
      ids.add(id);
    }
    return [...ids];
  }

  // Snapshot the boat position and time WITHOUT committing anything: the press-time capture that
  // the confirm dialog later hands back to trigger(). Undefined without a fix.
  // The snapshot is a plain object: the store cell value is a Svelte reactive proxy, and a proxy
  // cannot be structured-cloned into the stream worker when the mark is published (postMessage
  // throws DataCloneError and the boat-wide alarm silently never goes out).
  capture(): MobMark | undefined {
    const boat = this.#vessel.position;
    if (!boat || this.#vessel.positionStale) return undefined;
    return {
      position: { latitude: boat.latitude, longitude: boat.longitude },
      epochMs: this.#clock?.now ?? 0,
    };
  }

  // How old a capture is on the store's clock, so the confirm flow judges reuse freshness against
  // the same time source that stamped the mark. Undefined without a clock (treat as stale).
  captureAgeMs(mark: MobMark): number | undefined {
    if (!this.#clock) return undefined;
    return Math.max(0, this.#clock.now - mark.epochMs);
  }

  // Mark man overboard. The confirm flow passes the press-time capture so the seconds spent
  // confirming cannot carry the mark away from the person; with no capture (no fix at press or
  // since), the alarm still raises, position-less.
  trigger(mark?: MobMark): MobMark {
    const candidate = mark ?? this.capture() ?? { epochMs: this.#clock?.now ?? 0 };
    const committed = validMark(candidate);
    if (!committed) throw new TypeError('Invalid man-overboard mark.');
    this.#localAcknowledged = false;
    this.#setLocal(committed);
    return committed;
  }

  // Clear the local mark (recovery complete, or an accidental tap).
  cancel(): void {
    this.#localAcknowledged = false;
    this.#setLocal(null);
  }

  // Silence the tone; the strip and mark stay until canceled.
  acknowledge(): void {
    if (this.#local) this.#localAcknowledged = true;
    if (this.#remoteActive) {
      this.#remoteAcknowledgedActivations = Object.fromEntries(
        this.#remoteNotifications.map(({ path, activation }) => [path, activation]),
      );
    }
  }

  #setLocal(next: MobMark | null): void {
    this.#persisted.set(next);
    this.#local = next;
  }
}

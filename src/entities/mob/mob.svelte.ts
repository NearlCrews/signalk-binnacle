import type { OwnVessel } from '$entities/vessel';
import { isLatLon, type LatLon } from '$shared/geo';
import { isFiniteNumber, isRecord, type ReactiveClock } from '$shared/lib';
import { haversineMeters, rhumbBearingRad } from '$shared/nav';
import { type PersistedCodec, PersistedValue, type StorageLike } from '$shared/settings';
import { isSoundingNotification, type SignalKStore, SK_PATHS } from '$shared/signalk';

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
  #remoteAcknowledgedActivation = $state<number | undefined>(undefined);

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
      'binnacle:mob',
      null,
      storage,
      mobMarkCodec,
    );
    this.#local = validMark(this.#persisted.value);
    // Pre-create the cell so the first reactive read finds a tracked cell (the OwnVessel pitfall).
    store.ensureCells([SK_PATHS.mobNotification]);
  }

  #notification = $derived.by<{ state?: unknown; position?: unknown } | undefined>(() => {
    const value = this.#store.cell(SK_PATHS.mobNotification).value;
    if (!isRecord(value)) return undefined;
    return value as { state?: unknown; position?: unknown };
  });

  #remoteActive = $derived.by<boolean>(() => isSoundingNotification(this.#notification));

  #remotePosition = $derived.by<LatLon | undefined>(() => {
    if (!this.#remoteActive) return undefined;
    const position = this.#notification?.position;
    return isLatLon(position) ? position : undefined;
  });

  get active(): boolean {
    return this.#local !== null || this.#remoteActive;
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
    if (this.#local) return this.#localAcknowledged;
    if (!this.#remoteActive) return false;
    return (
      this.#remoteAcknowledgedActivation === this.#store.cell(SK_PATHS.mobNotification).activation
    );
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
    const committed = mark ?? this.capture() ?? { epochMs: this.#clock?.now ?? 0 };
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
    if (this.#local) {
      this.#localAcknowledged = true;
    } else if (this.#remoteActive) {
      this.#remoteAcknowledgedActivation = this.#store.cell(SK_PATHS.mobNotification).activation;
    }
  }

  #setLocal(next: MobMark | null): void {
    this.#local = next;
    this.#persisted.set(next);
  }
}

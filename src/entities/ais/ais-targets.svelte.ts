import { asNumber, isLatLon, type LatLon } from '$shared/geo';
import { isFiniteNumber, isRecord } from '$shared/lib';
import { type SignalKStore, SK_PATHS } from '$shared/signalk';
import { AIS_PRUNE_INTERVAL_MS, AIS_STALE_TTL_MS } from './ais-staleness';

// The Signal K spec types closestApproach.timeTo as an ISO-8601 duration string (e.g. "PT1M30S"),
// but some providers publish a raw number of seconds. Parse both: a number passes through, a
// string is converted to signed seconds (a negative or zero TCPA means the contact is opening or
// past), and anything unparseable yields undefined so a bad value reads as "no TCPA" rather than 0.
const ISO_DURATION =
  /^(-)?P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function parseIso8601DurationSeconds(value: unknown): number | undefined {
  if (isFiniteNumber(value)) return value;
  if (typeof value !== 'string') return undefined;
  const m = ISO_DURATION.exec(value.trim());
  if (!m) return undefined;
  const [, sign, years, months, weeks, days, hours, minutes, seconds] = m;
  // A bare "P" or "PT" with no components is not a valid duration.
  if (![years, months, weeks, days, hours, minutes, seconds].some((p) => p != null)) {
    return undefined;
  }
  const n = (p: string | undefined) => (p == null ? 0 : Number.parseFloat(p));
  // Fixed-average approximations: 365-day year and 30-day month, ignoring leap years and calendar
  // month lengths. Acceptable because TCPA providers publish only sub-hour durations in practice.
  const total =
    n(years) * 31_536_000 +
    n(months) * 2_592_000 +
    n(weeks) * 604_800 +
    n(days) * 86_400 +
    n(hours) * 3600 +
    n(minutes) * 60 +
    n(seconds);
  return sign === '-' ? -total : total;
}

// All angular and speed fields are SI (radians, m/s), like the rest of the store. Consumers
// convert to a compass bearing or knots at their own display edge.
export interface AisTargetView {
  id: string;
  name?: string;
  position: LatLon;
  cogRad?: number;
  headingRad?: number;
  sogMps?: number;
  shipTypeId?: number;
  cpaMeters?: number;
  tcpaSeconds?: number;
  // Signal K's enum: underway, anchored, moored, not under command, aground, and similar. Undefined
  // when the target has never reported it, which most Class B AIS transponders do not.
  navigationState?: string;
}

export class AisTargets {
  #store: SignalKStore;
  #cache: AisTargetView[] | undefined;
  #cacheVersion = -1;

  constructor(store: SignalKStore) {
    this.#store = store;
  }

  // Start the staleness prune timer; returns the disposer. The entity owns the policy (TTL and
  // cadence); the composition root only ties the timer to the app lifecycle.
  startPruning(): () => void {
    const id = setInterval(
      () => this.#store.pruneAis(Date.now(), AIS_STALE_TTL_MS),
      AIS_PRUNE_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }

  // Reading this in a reactive context takes a dependency on AIS changes, since the
  // store bumps aisVersion ($state) on every AIS update and prune. list() iterates a
  // non-reactive Map, so a consumer that needs to re-render must read this too.
  get version(): number {
    return this.#store.aisVersion;
  }

  list(): AisTargetView[] {
    // Rebuild only when AIS data changed. With aisVersion bumped only on real AIS
    // updates, own-vessel motion no longer forces a full list rebuild on consumers.
    const version = this.#store.aisVersion;
    if (this.#cache && this.#cacheVersion === version) return this.#cache;
    const out: AisTargetView[] = [];
    for (const [id, target] of this.#store.aisTargets) {
      const position = target.values.get(SK_PATHS.position);
      if (!isLatLon(position)) continue;
      const name = target.values.get(SK_PATHS.name);
      const approach = target.values.get(SK_PATHS.closestApproach);
      const navState = target.values.get(SK_PATHS.navigationState);
      out.push({
        id,
        name: typeof name === 'string' ? name : undefined,
        position,
        cogRad: asNumber(target.values.get(SK_PATHS.courseOverGroundTrue)),
        headingRad: asNumber(target.values.get(SK_PATHS.headingTrue)),
        sogMps: asNumber(target.values.get(SK_PATHS.speedOverGround)),
        shipTypeId: this.#numField(target.values.get(SK_PATHS.aisShipType), 'id'),
        cpaMeters: this.#numField(approach, 'distance'),
        tcpaSeconds: this.#timeToSeconds(approach),
        navigationState: typeof navState === 'string' ? navState : undefined,
      });
    }
    this.#cache = out;
    this.#cacheVersion = version;
    return out;
  }

  #numField(value: unknown, key: string): number | undefined {
    return isRecord(value) ? asNumber(value[key]) : undefined;
  }

  #timeToSeconds(approach: unknown): number | undefined {
    return isRecord(approach) ? parseIso8601DurationSeconds(approach.timeTo) : undefined;
  }
}

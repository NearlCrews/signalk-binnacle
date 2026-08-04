import { asNumber, isLatLon, type LatLon } from '$shared/geo';
import { isFiniteNumber, isRecord } from '$shared/lib';
import { type SignalKStore, SK_PATHS } from '$shared/signalk';
import {
  AIS_APPROACH_STALE_TTL_MS,
  AIS_MOTION_STALE_TTL_MS,
  AIS_PRUNE_INTERVAL_MS,
  AIS_STALE_TTL_MS,
} from './ais-staleness';

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

// One memoized view plus what it was derived from, so an unchanged vessel keeps its object
// identity across a rebuild and every downstream identity check (rows, overlays, keyed each blocks)
// stops there instead of treating the whole fleet as new.
interface CachedView {
  view: AisTargetView;
  // A reconnect invalidates every path, so the view has to be rebuilt even if nothing else moved.
  generation: number;
  // The store's per-target change counter, not its lastUpdate: an identical republish advances
  // freshness without changing anything renderable, and two frames can land in the same millisecond,
  // which would make a timestamp key reuse a view that is genuinely out of date.
  revision: number;
  // When the next clock-driven staleness boundary makes this view wrong, independent of any new
  // data: a motion field aging out changes the view with no update to trigger it.
  expiresAt: number;
}

export class AisTargets {
  #store: SignalKStore;
  #cache: AisTargetView[] | undefined;
  #cacheVersion = -1;
  #cacheExpiresAt = 0;
  // Long-lived and mutated in place: rebuilding it per pass allocated a whole Map, plus one set
  // per unchanged vessel, on every AIS change. Entries for vessels the store dropped are pruned
  // below, only when the sizes disagree.
  #views = new Map<string, CachedView>();
  // The id index for find(), refilled inside list()'s rebuild loop so it costs one Map insertion
  // per visited vessel and no second pass.
  #index = new Map<string, AisTargetView>();
  #now: () => number;

  constructor(store: SignalKStore, now: () => number = Date.now) {
    this.#store = store;
    this.#now = now;
  }

  // Start the staleness prune timer; returns the disposer. The entity owns the policy (TTL and
  // cadence); the composition root only ties the timer to the app lifecycle.
  startPruning(): () => void {
    const id = setInterval(() => {
      const now = this.#now();
      this.#store.pruneAis(now, AIS_STALE_TTL_MS);
      this.#store.pruneAisPaths([SK_PATHS.closestApproach], now, AIS_APPROACH_STALE_TTL_MS);
      this.#store.pruneAisPaths(
        [SK_PATHS.courseOverGroundTrue, SK_PATHS.headingTrue, SK_PATHS.speedOverGround],
        now,
        AIS_MOTION_STALE_TTL_MS,
      );
    }, AIS_PRUNE_INTERVAL_MS);
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
    const now = this.#now();
    if (this.#cache && this.#cacheVersion === version && now < this.#cacheExpiresAt) {
      return this.#cache;
    }
    const out: AisTargetView[] = [];
    this.#index.clear();
    let expiresAt = Number.POSITIVE_INFINITY;
    for (const [id, target] of this.#store.aisTargets) {
      // A vessel nobody heard from since its view was built, still inside every freshness window,
      // renders exactly the same. Reuse the object rather than minting an equal one.
      const cached = this.#views.get(id);
      if (
        cached &&
        cached.generation === this.#store.generation &&
        cached.revision === target.revision &&
        now < cached.expiresAt
      ) {
        out.push(cached.view);
        this.#index.set(id, cached.view);
        expiresAt = Math.min(expiresAt, cached.expiresAt);
        continue;
      }
      // Tracked per vessel as well as for the whole list, so one vessel's boundary passing does not
      // invalidate every other vessel's memoized view.
      let vesselExpiresAt = Number.POSITIVE_INFINITY;
      const current = (path: string, maxAgeMs?: number): unknown => {
        if (target.generations.get(path) !== this.#store.generation) return undefined;
        const epoch = target.epochs.get(path);
        if (maxAgeMs !== undefined && (epoch === undefined || now - epoch > maxAgeMs)) {
          return undefined;
        }
        if (maxAgeMs !== undefined && epoch !== undefined) {
          vesselExpiresAt = Math.min(vesselExpiresAt, epoch + maxAgeMs + 1);
        }
        return target.values.get(path);
      };
      const position = current(SK_PATHS.position, AIS_STALE_TTL_MS);
      if (!isLatLon(position)) {
        // No renderable position, so no view: drop any memo from when it had one.
        this.#views.delete(id);
        continue;
      }
      const name = current(SK_PATHS.name);
      const approachEpoch = target.epochs.get(SK_PATHS.closestApproach);
      const approachFresh =
        target.generations.get(SK_PATHS.closestApproach) === this.#store.generation &&
        approachEpoch !== undefined &&
        now - approachEpoch <= AIS_APPROACH_STALE_TTL_MS;
      const rawApproach = approachFresh ? target.values.get(SK_PATHS.closestApproach) : undefined;
      const cpa = this.#numField(rawApproach, 'distance');
      const tcpa = this.#timeToSeconds(rawApproach);
      const approach = cpa !== undefined && tcpa !== undefined ? { cpa, tcpa } : undefined;
      if (approachFresh && approachEpoch !== undefined) {
        vesselExpiresAt = Math.min(vesselExpiresAt, approachEpoch + AIS_APPROACH_STALE_TTL_MS + 1);
      }
      const navState = current(SK_PATHS.navigationState);
      const view: AisTargetView = {
        id,
        name: typeof name === 'string' ? name : undefined,
        position,
        cogRad: asNumber(current(SK_PATHS.courseOverGroundTrue, AIS_MOTION_STALE_TTL_MS)),
        headingRad: asNumber(current(SK_PATHS.headingTrue, AIS_MOTION_STALE_TTL_MS)),
        sogMps: asNumber(current(SK_PATHS.speedOverGround, AIS_MOTION_STALE_TTL_MS)),
        shipTypeId: this.#numField(current(SK_PATHS.aisShipType), 'id'),
        cpaMeters: approach?.cpa,
        tcpaSeconds: approach?.tcpa,
        navigationState: typeof navState === 'string' ? navState : undefined,
      };
      out.push(view);
      this.#index.set(id, view);
      this.#views.set(id, {
        view,
        generation: this.#store.generation,
        revision: target.revision,
        expiresAt: vesselExpiresAt,
      });
      expiresAt = Math.min(expiresAt, vesselExpiresAt);
    }
    // Only when a vessel was pruned from the store, which is the one way #views can hold an id the
    // loop above never visited.
    if (this.#views.size > this.#store.aisTargets.size) {
      for (const id of this.#views.keys()) {
        if (!this.#store.aisTargets.has(id)) this.#views.delete(id);
      }
    }
    this.#cache = out;
    this.#cacheVersion = version;
    this.#cacheExpiresAt = expiresAt;
    return out;
  }

  // list() keeps the index current, so a selected target looked up on every version bump costs
  // one hash instead of a scan of the whole fleet.
  find(id: string): AisTargetView | undefined {
    this.list();
    return this.#index.get(id);
  }

  #numField(value: unknown, key: string): number | undefined {
    return isRecord(value) ? asNumber(value[key]) : undefined;
  }

  #timeToSeconds(approach: unknown): number | undefined {
    return isRecord(approach) ? parseIso8601DurationSeconds(approach.timeTo) : undefined;
  }
}

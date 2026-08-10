import type { OwnVessel } from '$entities/vessel';
import { isLatLon, type LatLon } from '$shared/geo';
import type { ReactiveClock } from '$shared/lib';
import {
  etaSeconds,
  rhumbBearingRad,
  rhumbCrossTrackErrorMeters,
  rhumbDistanceMeters,
  vmgMps,
} from '$shared/nav';
import type {
  ActiveRoute,
  CourseCalculations,
  CourseInfo,
  CoursePoint,
  SignalKStore,
} from '$shared/signalk';
import { SK_PATHS } from '$shared/signalk';

export type CourseSource = 'server' | 'computed';

// Arrival radius used when the server reports no arrivalCircle for the active leg.
const DEFAULT_ARRIVAL_CIRCLE_METERS = 100;

// Arrival latches with hysteresis: once inside the circle, the boat must move out past
// circle * this factor (or the active point must change) before arrived clears, so GPS jitter at
// the boundary cannot re-fire the arrival alarm and banner.
const ARRIVAL_EXIT_FACTOR = 1.2;

// Course-provider calculations depend on live vessel motion. Expire them promptly so a stopped
// provider cannot leave a frozen distance inside the arrival circle or a stale ETA on screen.
const COURSE_CALC_STALE_MS = 30_000;

// The floor under the VMG-based time-to-go fallback: a tenth of a knot toward the mark is drift
// and numerical dust, not progress, and dividing by it promises thousand-hour arrivals.
const MIN_PROGRESS_VMG_MPS = 0.05;

// calcValues does not stream as one object: the course-provider publishes each value as its own leaf
// delta (navigation.course.calcValues.<field>) and the core never emits the parent, so each field is
// held in its own store cell. These are the fields the guidance reads; the REST seed is decomposed
// into the same cells so the stream keeps them live afterward.
const CALC_VALUE_FIELDS = [
  'crossTrackError',
  'distance',
  'bearingTrue',
  'velocityMadeGood',
  'timeToGo',
  'estimatedTimeOfArrival',
] as const;

const calcLeafPath = (field: (typeof CALC_VALUE_FIELDS)[number]): string =>
  `${SK_PATHS.courseCalcValues}.${field}`;

// Every course cell the guidance owns, so the pre-created, seeded, staleness-checked, and cleared
// sets provably match. calcValues contributes one cell per leaf field, since that is how it streams.
const COURSE_CELL_PATHS: readonly string[] = [
  SK_PATHS.courseNextPoint,
  SK_PATHS.coursePreviousPoint,
  SK_PATHS.courseActiveRoute,
  SK_PATHS.courseArrivalCircle,
  ...CALC_VALUE_FIELDS.map(calcLeafPath),
];

// Source-agnostic active-following guidance. It reads the Signal K navigation.course paths from
// the store and exposes the active-leg readouts, preferring the server's calcValues when a
// provider populates them and computing the derived values client-side when they are absent or
// null. All values are SI (meters, radians, m/s, seconds); positions are decimal degrees.
export class CourseGuidance {
  #store: SignalKStore;
  #vessel: OwnVessel;
  #clock: ReactiveClock | undefined;

  constructor(store: SignalKStore, vessel: OwnVessel, clock?: ReactiveClock) {
    this.#store = store;
    this.#vessel = vessel;
    this.#clock = clock;
    // Pre-create the cells so the first access inside a reactive context finds an existing,
    // tracked cell. A cell created lazily during a reactive read is not tracked, so later
    // updates would not re-render. This mirrors OwnVessel's constructor.
    store.ensureCells(COURSE_CELL_PATHS);
  }

  // Seed every course cell from a one-time REST hydration, so the nav strip shows values immediately
  // before the stream sends the first change. asOf is the wall clock when the hydrate began; a slow
  // REST response must not clobber fresher streamed deltas (activate, then skip twice before the
  // hydrate resolves), so the seed is dropped when any course cell took a stream write at or after
  // that moment (each cell's epoch is the wall clock of its last stream write, zero until one lands).
  seed(
    info: CourseInfo | undefined,
    calc: CourseCalculations | undefined,
    asOf: number = Date.now(),
  ): void {
    // Per cell, not all-or-nothing: calcValues streams continuously, so a single calcValues delta
    // landing before a slow hydrate would otherwise drop the whole seed, including the info cells
    // (nextPoint, previousPoint, activeRoute, arrivalCircle) that only the REST read can supply
    // under subscribe=none. Each cell is seeded only when no stream write landed at or after the
    // hydrate began, so a fresh streamed value is never clobbered by the slower REST snapshot.
    const seedCell = (path: string, value: unknown): void => {
      const cell = this.#store.cell(path);
      if (cell.streamed && cell.epoch >= asOf) return;
      cell.value = value;
      cell.epoch = asOf;
      cell.generation = this.#store.generation;
      cell.streamed = false;
    };
    if (info) {
      seedCell(SK_PATHS.courseNextPoint, info.nextPoint);
      seedCell(SK_PATHS.coursePreviousPoint, info.previousPoint);
      seedCell(SK_PATHS.courseActiveRoute, info.activeRoute);
      seedCell(SK_PATHS.courseArrivalCircle, info.arrivalCircle);
    }
    if (calc) {
      // calcValues streams as leaf deltas, so the snapshot is decomposed into the same per-field
      // cells the stream writes; each field is seeded only when no stream delta landed at or after
      // the hydrate, matching the per-cell staleness rule used for the info cells above.
      for (const field of CALC_VALUE_FIELDS) {
        const path = calcLeafPath(field);
        seedCell(path, calc[field]);
      }
    }
  }

  // Clear every course cell on stop, so no previousPoint, activeRoute, arrivalCircle, or calcValues
  // lingers to leak into the next activation.
  clear(): void {
    for (const path of COURSE_CELL_PATHS) {
      const cell = this.#store.cell(path);
      cell.value = undefined;
      cell.epoch = 0;
      cell.generation = this.#store.generation;
      cell.streamed = false;
    }
  }

  #info = $derived.by<CourseInfo>(() => ({
    nextPoint: this.#currentValue(SK_PATHS.courseNextPoint) as CoursePoint | undefined,
    previousPoint: this.#currentValue(SK_PATHS.coursePreviousPoint) as CoursePoint | undefined,
    activeRoute: this.#currentValue(SK_PATHS.courseActiveRoute) as ActiveRoute | undefined,
    arrivalCircle: this.#currentValue(SK_PATHS.courseArrivalCircle) as number | undefined,
  }));

  // Assembled from the per-field leaf cells that the stream and the REST seed both write. Undefined
  // until at least one field is present, so an inactive course or an absent provider reads as a
  // computed source. The leaf cells are read individually, so a single streamed field keeps the
  // readouts live.
  #calc = $derived.by<CourseCalculations | undefined>(() => {
    let present = false;
    const read = <T>(field: (typeof CALC_VALUE_FIELDS)[number]): T | null | undefined => {
      const v = this.#currentValue(calcLeafPath(field), COURSE_CALC_STALE_MS);
      if (v != null) present = true;
      return v as T | null | undefined;
    };
    const calc: CourseCalculations = {
      crossTrackError: read<number>('crossTrackError'),
      distance: read<number>('distance'),
      bearingTrue: read<number>('bearingTrue'),
      velocityMadeGood: read<number>('velocityMadeGood'),
      timeToGo: read<number>('timeToGo'),
      estimatedTimeOfArrival: read<string>('estimatedTimeOfArrival'),
    };
    return present ? calc : undefined;
  });

  get active(): boolean {
    return this.#next !== undefined;
  }

  // True when the active point is the last in the route, so the arrival advance does not step past
  // the end. Conservative: false when the route extent is unknown.
  get isLastPoint(): boolean {
    const index = this.activePointIndex;
    const total = this.activePointTotal;
    if (index === undefined || total === undefined) return false;
    return index >= total - 1;
  }

  // The active route's destination index and total point count, when a route (not a single "go to")
  // is active, so a consumer can sum the legs still ahead for a whole-route distance and ETA.
  get activePointIndex(): number | undefined {
    const index = this.#info.activeRoute?.pointIndex;
    const total = this.activePointTotal;
    return Number.isInteger(index) &&
      index !== undefined &&
      index >= 0 &&
      total !== undefined &&
      index < total
      ? index
      : undefined;
  }

  get activePointTotal(): number | undefined {
    const total = this.#info.activeRoute?.pointTotal;
    return Number.isInteger(total) && total !== undefined && total > 0 ? total : undefined;
  }

  // A validated snapshot for an arrival-edge advance. Returning a copy prevents a consumer from
  // mutating the streamed object while preserving the route identity and direction the Course API
  // needs to confirm that the same route is still active after the server auto-advance grace period.
  get activeRouteSnapshot(): ActiveRoute | undefined {
    const route = this.#info.activeRoute;
    const pointIndex = this.activePointIndex;
    const pointTotal = this.activePointTotal;
    if (typeof route?.href !== 'string' || !route.href || pointIndex === undefined)
      return undefined;
    return {
      href: route.href,
      pointIndex,
      ...(pointTotal !== undefined ? { pointTotal } : {}),
      ...(route.reverse !== undefined ? { reverse: route.reverse } : {}),
      ...(route.name !== undefined ? { name: route.name } : {}),
    };
  }

  get canAdvanceRoute(): boolean {
    const index = this.activePointIndex;
    const total = this.activePointTotal;
    if (index === undefined || total === undefined) return false;
    return index < total - 1;
  }

  get canRetreatRoute(): boolean {
    const index = this.activePointIndex;
    const total = this.activePointTotal;
    if (index === undefined || total === undefined) return false;
    return index > 0;
  }

  // Signal K pointIndex is an index into traversal order, even for a reversed route. The server maps
  // that sequential index onto reversed route geometry when it selects nextPoint and previousPoint.
  get routeReversed(): boolean {
    return this.#info.activeRoute?.reverse === true;
  }

  // 'server' when the provider supplied any populated calcValue, otherwise 'computed'. A single-mark
  // "go to" can omit cross-track error (it has no leg origin) while still publishing distance,
  // bearing, VMG, and time-to-go, so keying on cross-track error alone would discard a server ETA as
  // if it were a local estimate.
  get source(): CourseSource {
    const c = this.#calc;
    if (!c) return 'computed';
    const finite = (value: number | null | undefined): value is number =>
      typeof value === 'number' && Number.isFinite(value);
    const populated =
      finite(c.crossTrackError) ||
      (finite(c.distance) && c.distance >= 0) ||
      (finite(c.bearingTrue) && c.bearingTrue >= 0 && c.bearingTrue < 2 * Math.PI) ||
      finite(c.velocityMadeGood) ||
      (finite(c.timeToGo) && c.timeToGo >= 0);
    return populated ? 'server' : 'computed';
  }

  get nextPointName(): string | undefined {
    const name = this.#info.nextPoint?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : undefined;
  }

  // The active destination position (the next point of the course or single-mark "go to"), for the
  // map to draw the destination marker and the vessel-to-destination course line. Undefined when no
  // course is active. Decimal degrees, like every position.
  get nextPosition(): LatLon | undefined {
    return this.#next;
  }

  // The server's estimated time of arrival as an ISO-8601 instant, preferred over a client clock
  // estimate when a provider populates calcValues. Only meaningful when source is 'server'; when the
  // values are computed client-side it is undefined and the consumer falls back to now plus its own
  // time-to-go.
  get estimatedTimeOfArrivalIso(): string | undefined {
    const value = this.#calc?.estimatedTimeOfArrival;
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
  }

  get #next(): LatLon | undefined {
    // Validate the streamed position before it reaches the map and the geodesy: a malformed or
    // NaN nextPoint.position would otherwise poison the destination marker and every fallback
    // distance, bearing, and cross-track computation, unlike the validated vessel and AIS paths.
    const pos = this.#info.nextPoint?.position;
    return isLatLon(pos) ? pos : undefined;
  }

  // The vessel position only while the fix is fresh. A stale fix must not feed the computed-fallback
  // geodesy, or DTW, BTW, XTE, and VMG would keep ticking off a frozen position. The server's own
  // calcValues, when present, are the server's responsibility and pass through untouched.
  get #freshPos(): LatLon | undefined {
    return this.#vessel.positionStale ? undefined : this.#vessel.position;
  }

  // The leg origin: the server's previousPoint when present, else the vessel's own position so a
  // single-mark "go to" with no leg origin still yields a sensible cross-track baseline.
  get #prev(): LatLon | undefined {
    const previous = this.#info.previousPoint?.position;
    return isLatLon(previous) ? previous : this.#freshPos;
  }

  #finiteCalc(field: keyof CourseCalculations): number | undefined {
    const value = this.#calc?.[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  #currentValue(path: string, maxAgeMs?: number): unknown {
    const cell = this.#store.cell(path);
    if (cell.epoch > 0 && cell.generation !== this.#store.generation) return undefined;
    if (maxAgeMs !== undefined && cell.epoch > 0 && this.#clock) {
      if (this.#clock.now - cell.epoch > maxAgeMs) return undefined;
    }
    return cell.value;
  }

  // The active-leg readouts are $derived so each leg's geodesy is computed once per dependency
  // change and shared across readers, not recomputed on every access. Several consumers read more
  // than one (the nav strip reads cross-track twice, time-to-go reads distance, the arrival effect
  // reads arrived which reads distance), so without memoization the same rhumb distance and
  // cross-track ran two or three times per render in the computed-fallback path.
  distanceToNextMeters: number | undefined = $derived.by(() => {
    const supplied = this.#finiteCalc('distance');
    if (supplied !== undefined && supplied >= 0) return supplied;
    const pos = this.#freshPos;
    return pos && this.#next ? rhumbDistanceMeters(pos, this.#next) : undefined;
  });

  bearingToNextRad: number | undefined = $derived.by(() => {
    const supplied = this.#finiteCalc('bearingTrue');
    if (supplied !== undefined && supplied >= 0 && supplied < 2 * Math.PI) return supplied;
    const pos = this.#freshPos;
    return pos && this.#next ? rhumbBearingRad(pos, this.#next) : undefined;
  });

  crossTrackErrorMeters: number | undefined = $derived.by(() => {
    const supplied = this.#finiteCalc('crossTrackError');
    if (supplied !== undefined) return supplied;
    const pos = this.#freshPos;
    return pos && this.#prev && this.#next
      ? rhumbCrossTrackErrorMeters(this.#prev, this.#next, pos)
      : undefined;
  });

  velocityMadeGoodMps: number | undefined = $derived.by(() => {
    const supplied = this.#finiteCalc('velocityMadeGood');
    if (supplied !== undefined) return supplied;
    const pos = this.#freshPos;
    const sog = this.#vessel.sogStale ? undefined : this.#vessel.sogMps;
    const cog = this.#vessel.cogStale ? undefined : this.#vessel.cogRad;
    return pos && this.#next && sog != null && cog != null
      ? vmgMps(pos, this.#next, sog, cog)
      : undefined;
  });

  // The active-leg fallback divides by positive VMG toward the waypoint, never SOG: five knots of
  // SOG on a tack away from the mark is not progress, and an optimistic time is worse than none.
  // Zero or negative VMG yields unavailable. A fresh server timeToGo stays preferred (regression
  // guard: the course provider's estimate, when supplied, is authoritative).
  timeToGoSeconds: number | undefined = $derived.by(() => {
    const supplied = this.#finiteCalc('timeToGo');
    if (supplied !== undefined && supplied >= 0) return supplied;
    const d = this.distanceToNextMeters;
    const vmg = this.velocityMadeGoodMps;
    return d != null && vmg != null && vmg >= MIN_PROGRESS_VMG_MPS ? etaSeconds(d, vmg) : undefined;
  });

  // What produced timeToGoSeconds, so surfaces can label the estimate honestly.
  timeToGoBasis: 'server' | 'vmg' | undefined = $derived.by(() => {
    const supplied = this.#finiteCalc('timeToGo');
    if (supplied !== undefined && supplied >= 0) return 'server';
    return this.timeToGoSeconds !== undefined ? 'vmg' : undefined;
  });

  // Per-field provenance: a partial server course supplies some calcValues while Binnacle fills
  // the rest locally, and flattening that mix to one source labeled local numbers as the
  // server's. Undefined means the field is unavailable. Each check mirrors its getter's own
  // validity guard.
  fieldSources: {
    distance: 'server' | 'local' | undefined;
    bearing: 'server' | 'local' | undefined;
    crossTrack: 'server' | 'local' | undefined;
    vmg: 'server' | 'local' | undefined;
    timeToGo: 'server' | 'local' | undefined;
  } = $derived.by(() => {
    const distanceSupplied = this.#finiteCalc('distance');
    const bearingSupplied = this.#finiteCalc('bearingTrue');
    const crossTrackSupplied = this.#finiteCalc('crossTrackError');
    const vmgSupplied = this.#finiteCalc('velocityMadeGood');
    const field = (supplied: boolean, available: boolean): 'server' | 'local' | undefined =>
      supplied ? 'server' : available ? 'local' : undefined;
    return {
      distance: field(
        distanceSupplied !== undefined && distanceSupplied >= 0,
        this.distanceToNextMeters !== undefined,
      ),
      bearing: field(
        bearingSupplied !== undefined && bearingSupplied >= 0 && bearingSupplied < 2 * Math.PI,
        this.bearingToNextRad !== undefined,
      ),
      crossTrack: field(crossTrackSupplied !== undefined, this.crossTrackErrorMeters !== undefined),
      vmg: field(vmgSupplied !== undefined, this.velocityMadeGoodMps !== undefined),
      timeToGo: field(this.timeToGoBasis === 'server', this.timeToGoSeconds !== undefined),
    };
  });

  // Latch bookkeeping for the arrival hysteresis. Plain fields, not $state: they are internal to
  // the derived below (writing reactive state from inside a derived is unsafe), and the derived
  // already recomputes on every input that can change the latch.
  #arrivedLatched = false;
  #arrivalLatchKey: string | undefined;

  arrived: boolean = $derived.by(() => {
    const next = this.#next;
    const route = this.#info.activeRoute;
    const routePointIndex = route?.pointIndex;
    const routePointKey =
      typeof route?.href === 'string' &&
      route.href.length > 0 &&
      typeof routePointIndex === 'number' &&
      Number.isSafeInteger(routePointIndex) &&
      routePointIndex >= 0
        ? `route:${route.href}:${routePointIndex}`
        : undefined;
    // Consecutive route points may intentionally share coordinates. Prefer the server's route and
    // traversal identity so advancing to such a point resets hysteresis; single-mark courses and
    // incomplete provider data fall back to the destination coordinate.
    const key = routePointKey ?? (next ? `position:${next.latitude},${next.longitude}` : undefined);
    if (key !== this.#arrivalLatchKey) {
      this.#arrivalLatchKey = key;
      this.#arrivedLatched = false;
    }
    // Arrival is safety-sensitive and can mutate the active route. Compute it only from the fresh
    // own-vessel fix and active point, never from a provider distance that may lag for its display TTL.
    const ownPosition = this.#freshPos;
    const d = ownPosition && next ? rhumbDistanceMeters(ownPosition, next) : undefined;
    if (key === undefined || d == null) {
      this.#arrivedLatched = false;
      return false;
    }
    const configuredCircle = this.#info.arrivalCircle;
    const circle =
      typeof configuredCircle === 'number' &&
      Number.isFinite(configuredCircle) &&
      configuredCircle > 0
        ? configuredCircle
        : DEFAULT_ARRIVAL_CIRCLE_METERS;
    if (this.#arrivedLatched) {
      // Latched: only a clear move past the exit margin releases it, so jitter at the circle
      // boundary cannot re-fire the arrival alarm.
      if (d > circle * ARRIVAL_EXIT_FACTOR) this.#arrivedLatched = false;
    } else if (d <= circle) {
      this.#arrivedLatched = true;
    }
    return this.#arrivedLatched;
  });
}

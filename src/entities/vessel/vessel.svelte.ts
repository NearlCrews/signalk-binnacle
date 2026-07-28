import { asNumber, isLatLon, type LatLon } from '$shared/geo';
import type { ReactiveClock } from '$shared/lib';
import { type SignalKStore, SK_PATHS } from '$shared/signalk';

// How long the own-vessel fix may go without a position update before it is treated as lost. The
// position is subscribed near 1 Hz, so a gap this long is a real dropout, not stream jitter. Holding
// a frozen fix out as if it were live is the worst lie to tell a navigator, so the readouts, the nav
// guidance, and the collision math all degrade once the fix ages past this.
const VESSEL_DATA_STALE_MS = 10_000;

// The three references a Signal K sounder may publish a depth against. A depth number means nothing
// without the reference it was measured from, so every reading carries its source.
export type DepthSource = 'keel' | 'surface' | 'transducer';

export interface DepthReading {
  meters: number | undefined;
  source: DepthSource | undefined;
  path: string;
  stale: boolean;
}

const DEPTH_SOURCE_PATHS: Record<DepthSource, string> = {
  keel: SK_PATHS.depthBelowKeel,
  surface: SK_PATHS.depthBelowSurface,
  transducer: SK_PATHS.depthBelowTransducer,
};

// The tag beside a depth readout, and the full phrase for its title or accessible name.
export const DEPTH_SOURCE_LABELS: Record<DepthSource, string> = {
  keel: 'Keel',
  surface: 'Surface',
  transducer: 'Xducer',
};

export const DEPTH_SOURCE_TITLES: Record<DepthSource, string> = {
  keel: 'Depth below the keel',
  surface: 'Depth below the surface',
  transducer: 'Depth below the transducer',
};

// One priority order per purpose, side by side so the differences are visible. Safety wants the
// most PROTECTIVE reading, the smallest number for the same water: keel (draft removed), then the
// raw transducer, then surface last, because belowSurface is belowTransducer plus the transducer's
// submersion and always reads deeper. A positive-offset sounder publishes transducer and surface
// together, so surface-before-transducer would fire the shallow alarm late by the offset. Anchor
// scope wants the whole water column the rode spans, so it never reads the keel-corrected path.
// The trend latches its source for the session, so it takes the raw transducer first: the reading
// least likely to appear mid-session.
const SAFETY_DEPTH_PRIORITY: readonly DepthSource[] = ['keel', 'transducer', 'surface'];
const ANCHOR_DEPTH_PRIORITY: readonly DepthSource[] = ['surface', 'transducer'];
const TREND_DEPTH_PRIORITY: readonly DepthSource[] = ['transducer', 'surface', 'keel'];

export class OwnVessel {
  #store: SignalKStore;
  #clock: ReactiveClock | undefined;

  constructor(store: SignalKStore, clock?: ReactiveClock) {
    this.#store = store;
    this.#clock = clock;
    // Pre-create the cells this vessel reads. The store creates a cell lazily on first
    // access; if that first access is a reactive template read, the freshly created
    // $state source is not tracked and later updates do not re-render. Creating the
    // cells up front means every read finds an existing, tracked cell.
    store.ensureCells([
      SK_PATHS.position,
      SK_PATHS.speedOverGround,
      SK_PATHS.courseOverGroundTrue,
      SK_PATHS.headingTrue,
      SK_PATHS.depthBelowTransducer,
      SK_PATHS.depthBelowKeel,
      SK_PATHS.depthBelowSurface,
      SK_PATHS.windSpeedApparent,
      SK_PATHS.outsidePressure,
    ]);
  }

  // Speed over ground in m/s (SI). Consumers convert to knots at the display edge.
  get sogMps(): number | undefined {
    return this.#num(SK_PATHS.speedOverGround);
  }

  // Course over ground in radians (SI). Display converts to a compass bearing at its edge.
  get cogRad(): number | undefined {
    return this.#num(SK_PATHS.courseOverGroundTrue);
  }

  // Heading (true) in radians (SI).
  get headingRad(): number | undefined {
    return this.#num(SK_PATHS.headingTrue);
  }

  // Apparent wind speed in m/s (SI), when an anemometer publishes it.
  get windSpeedApparentMps(): number | undefined {
    return this.#num(SK_PATHS.windSpeedApparent);
  }

  // Outside air pressure in Pascals (SI), when a barometer publishes it.
  get outsidePressurePa(): number | undefined {
    return this.#num(SK_PATHS.outsidePressure);
  }

  get position(): LatLon | undefined {
    const value = this.#raw(SK_PATHS.position);
    return isLatLon(value) ? value : undefined;
  }

  // Depth in meters (SI) for the safety surfaces: the status chip, the shallow monitor, and the
  // depth instrument all read this one resolution, so the boat can never show two contradicting
  // Depth numbers. A stale winner stays the winner: falling through to a less corrected source
  // because the preferred one aged would silently change what the number means, mid-passage.
  get safetyDepth(): DepthReading {
    return this.#depthReading(this.#firstPublishedDepth(SAFETY_DEPTH_PRIORITY));
  }

  // Depth in meters (SI) for anchor scope, which is reckoned against the whole water column from
  // the surface. The keel-corrected path is deliberately never read: it has the draft removed.
  get anchorDepth(): DepthReading {
    return this.#depthReading(this.#firstPublishedDepth(ANCHOR_DEPTH_PRIORITY));
  }

  // Depth in meters (SI) for the accumulating depth history. The source latches on the first read
  // that finds a published path and never changes for the session: a keel path appearing an hour
  // in would step every later sample by one draft and draw a shoaling trend that never happened.
  // Deliberately a plain field, not $state: the latch is a session fact, and writing $state during
  // a derived read is a mutation error.
  #trendSource: DepthSource | undefined;
  get trendDepth(): DepthReading {
    this.#trendSource ??= this.#firstPublishedDepth(TREND_DEPTH_PRIORITY);
    return this.#depthReading(this.#trendSource);
  }

  // True when a value was once received but has not refreshed within VESSEL_DATA_STALE_MS, so the
  // last reading is no longer trustworthy. False before the first value (absent, not stale) and
  // false when no clock is wired (tests, and any caller that does not need staleness). Each flag
  // reads the ticking clock, so it flips on its own the moment the feed stops, without a fresh
  // frame to trigger it. Every flag is its own $derived boolean so the 1 Hz tick invalidates only
  // these flags: a consumer derived (the collision assessment reads sogStale and cogStale on every
  // pass) re-runs only when a flag actually flips, not once per second.
  #positionStale = $derived(this.#pathStale(SK_PATHS.position));
  #sogStale = $derived(this.#pathStale(SK_PATHS.speedOverGround));
  #cogStale = $derived(this.#pathStale(SK_PATHS.courseOverGroundTrue));
  #headingStale = $derived(this.#pathStale(SK_PATHS.headingTrue));
  #keelDepthStale = $derived(this.#pathStale(SK_PATHS.depthBelowKeel));
  #surfaceDepthStale = $derived(this.#pathStale(SK_PATHS.depthBelowSurface));
  #transducerDepthStale = $derived(this.#pathStale(SK_PATHS.depthBelowTransducer));
  #windStale = $derived(this.#pathStale(SK_PATHS.windSpeedApparent));
  #pressureStale = $derived(this.#pathStale(SK_PATHS.outsidePressure));

  get positionStale(): boolean {
    return this.#positionStale;
  }

  get sogStale(): boolean {
    return this.#sogStale;
  }

  get cogStale(): boolean {
    return this.#cogStale;
  }

  get headingStale(): boolean {
    return this.#headingStale;
  }

  get windStale(): boolean {
    return this.#windStale;
  }

  get pressureStale(): boolean {
    return this.#pressureStale;
  }

  // The highest-priority depth source that has ever reported, or undefined on a boat with no
  // sounder at all.
  #firstPublishedDepth(priority: readonly DepthSource[]): DepthSource | undefined {
    return priority.find((source) => this.#store.cell(DEPTH_SOURCE_PATHS[source]).epoch > 0);
  }

  // One reading against one reference. With no source resolved the reading grades on the
  // transducer path, the conventional depth path a stock sounder feeds.
  #depthReading(source: DepthSource | undefined): DepthReading {
    const graded = source ?? 'transducer';
    const path = DEPTH_SOURCE_PATHS[graded];
    return { meters: this.#num(path), source, path, stale: this.#depthSourceStale(graded) };
  }

  // Staleness comes from the memoized per-path flag, never a fresh clock read, so a consumer
  // reading a depth re-runs when the reading actually changes rather than once per tick.
  #depthSourceStale(source: DepthSource): boolean {
    if (source === 'keel') return this.#keelDepthStale;
    if (source === 'surface') return this.#surfaceDepthStale;
    return this.#transducerDepthStale;
  }

  #raw(path: string): unknown {
    return this.#store.cell(path).value;
  }

  // Read a cell value coerced to a finite number (undefined otherwise), the SI reader every
  // numeric getter shares.
  #num(path: string): number | undefined {
    return asNumber(this.#raw(path));
  }

  #pathStale(path: string): boolean {
    const cell = this.#store.cell(path);
    if (cell.epoch > 0 && cell.generation !== this.#store.generation) return true;
    if (!this.#clock) return false;
    const epoch = cell.epoch;
    return epoch > 0 && this.#clock.now - epoch > VESSEL_DATA_STALE_MS;
  }
}

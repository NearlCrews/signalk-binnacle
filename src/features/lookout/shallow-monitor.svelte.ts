import type { UnitsStore } from '$entities/units';
import type { DepthReading } from '$entities/vessel';
import { type AlarmControl, GatedAlarm } from '$shared/audio';
import { formatLengthOr, lengthUnit } from '$shared/lib';
import { DEFAULT_THRESHOLDS, type PersistedValue, type Thresholds } from '$shared/settings';
import { fetchPathMeta, type MetaZone, type PathMeta, zoneStateFor } from '$shared/signalk';
import { isShallowAlarmActive, SHALLOW_TONE } from './shallow-alarm';

// Whether the shallow alarm is actually watching the water. A tone that cannot fire is worth saying
// out loud: a boat with no sounder, or one whose sounder just dropped out, is not being monitored.
export type ShallowMonitorState = 'monitoring' | 'stale' | 'no-source';

// Where the bound that fires the alarm comes from. The server wins when it publishes depth zones,
// so one boat cannot be told two different shallow limits.
export type ShallowThresholdSource = 'server' | 'local';

interface ShallowControllerDeps {
  // A getter, not a value: the reading is rebuilt on every sample, and capturing one at
  // construction would freeze the alarm on the depth the app started with.
  getSafetyDepth: () => DepthReading;
  thresholds: PersistedValue<Thresholds>;
  units: UnitsStore;
  origin: string;
  getToken: () => string | undefined;
  alarm?: AlarmControl;
}

// The deepest reading the server still calls an alarm, which is what the panel shows as the bound.
// An alarm zone open at the top has no such depth, so it reports none rather than a wrong number.
function alarmBound(zones: readonly MetaZone[]): number | undefined {
  let bound: number | undefined;
  for (const zone of zones) {
    // Both grades band as alarm in zoneStateFor, so both set the bound.
    if (zone.state !== 'alarm' && zone.state !== 'emergency') continue;
    if (zone.upper === undefined) continue;
    if (bound === undefined || zone.upper > bound) bound = zone.upper;
  }
  return bound;
}

// Owns the shallow-water alarm: the tone, the threshold the server or the skipper set, the
// live-region text, and whether the alarm can monitor at all. The depth datum itself stays in the
// vessel entity, so this and the depth chip can never disagree about which path won.
export function createShallowController(deps: ShallowControllerDeps) {
  const alarm = new GatedAlarm(SHALLOW_TONE, deps.alarm);
  // Zones are near-static, so they are fetched once per path per session. A null entry is the
  // in-flight and known-empty sentinel; it is deleted again after a tokenless failure so granting
  // access later still finds the zones.
  const metaCache = new Map<string, PathMeta | null>();
  let metaVersion = $state(0);

  const depth = $derived(deps.getSafetyDepth());
  // Only a source that has actually published has a winning path worth asking the server about.
  const winningPath = $derived(depth.source === undefined ? undefined : depth.path);
  const localLimit = $derived(
    deps.thresholds.value.shallowDepthMeters ?? DEFAULT_THRESHOLDS.shallowDepthMeters,
  );

  // Server zones take over only when they carry an alarm band. A warning-only zone set would
  // otherwise disarm the alarm entirely, which is a silent safety regression.
  const serverZones = $derived.by<MetaZone[] | undefined>(() => {
    void metaVersion;
    if (winningPath === undefined) return undefined;
    const zones = metaCache.get(winningPath)?.zones;
    if (!zones || zones.length === 0) return undefined;
    return zones.some((zone) => zone.state === 'alarm' || zone.state === 'emergency')
      ? zones
      : undefined;
  });

  const thresholdSource = $derived<ShallowThresholdSource>(serverZones ? 'server' : 'local');
  const effectiveLimitMeters = $derived(serverZones ? alarmBound(serverZones) : localLimit);

  const monitorState = $derived<ShallowMonitorState>(
    depth.source === undefined ? 'no-source' : depth.stale ? 'stale' : 'monitoring',
  );

  const alarming = $derived.by(() => {
    const { meters, stale } = depth;
    if (stale) return false;
    return serverZones
      ? zoneStateFor(meters, serverZones) === 'alarm'
      : isShallowAlarmActive(meters, stale, localLimit);
  });

  const alert = $derived.by(() => {
    if (monitorState === 'stale')
      return 'Depth data lost. Shallow-water monitoring is unavailable.';
    if (!alarming) return '';
    const unit = lengthUnit(deps.units.mode);
    const shown = formatLengthOr(depth.meters, deps.units.mode);
    const limit = effectiveLimitMeters;
    if (limit === undefined) {
      return `Shallow water: depth ${shown} ${unit}, inside the server's depth alarm zone.`;
    }
    return `Shallow water: depth ${shown} ${unit}, under the ${formatLengthOr(limit, deps.units.mode)} ${unit} alarm threshold.`;
  });

  function loadZones(path: string): void {
    if (metaCache.has(path)) return;
    // Token read at call time so a rotating token is always current.
    const token = deps.getToken();
    // Sentinel before the async call: prevents a second fetch while the first is in flight.
    metaCache.set(path, null);
    void fetchPathMeta(deps.origin, token, path).then((result) => {
      if (result !== undefined) metaCache.set(path, result);
      else if (token !== undefined) metaCache.set(path, null);
      // Fetched without a token (likely a 401 before auth): drop the sentinel so a later visit to
      // this path retries once the user has granted access.
      else metaCache.delete(path);
      metaVersion += 1;
    });
  }

  // Keyed on the path alone, so a 1 Hz depth sample does not re-enter the fetch bookkeeping.
  $effect(() => {
    if (winningPath !== undefined) loadZones(winningPath);
  });

  $effect(() => {
    alarm.update(alarming);
  });

  return {
    // Silence the tone outright (teardown). There is no prime here: the app resumes one shared
    // audio context through primeAlarmAudio(), so a per-alarm prime would be dead weight.
    stop: () => alarm.stop(),
    get alarming() {
      return alarming;
    },
    get alert() {
      return alert;
    },
    get effectiveLimitMeters() {
      return effectiveLimitMeters;
    },
    get thresholdSource() {
      return thresholdSource;
    },
    get monitorState() {
      return monitorState;
    },
  };
}

export type ShallowController = ReturnType<typeof createShallowController>;

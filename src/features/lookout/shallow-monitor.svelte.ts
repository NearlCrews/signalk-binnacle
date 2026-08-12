import type { UnitsStore } from '$entities/units';
import type { DepthReading } from '$entities/vessel';
import { type AlarmControl, GatedAlarm } from '$shared/audio';
import { formatLengthOr, lengthUnit } from '$shared/lib';
import { DEFAULT_THRESHOLDS, type PersistedValue, type Thresholds } from '$shared/settings';
import {
  createPathMetaCache,
  type MetaZone,
  NOTIFICATIONS_PREFIX,
  zoneStateFor,
} from '$shared/signalk';
import { isShallowAlarmActive, SHALLOW_TONE } from './shallow-alarm';

// Whether the shallow alarm is actually watching the water. A tone that cannot fire is worth saying
// out loud: a boat with no sounder, one whose sounder just dropped out, and one whose sounder is
// streaming fresh but unusable values (bottom-lock loss publishes nulls) are all unmonitored.
export type ShallowMonitorState = 'monitoring' | 'stale' | 'no-reading' | 'no-source';

// Which source sets the bound that currently governs the alarm. Server zones and the local
// threshold merge conservatively: the deeper bound fires first, so the server can tighten the
// alarm but never quietly loosen a limit the skipper set deeper.
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
  // Zones are near-static, so a resolved fetch holds for the session; a failed one retries on the
  // next reactive visit (token arriving, path changing) via the shared cache semantics.
  const metaCache = createPathMetaCache(deps.origin, deps.getToken);

  const depth = $derived(deps.getSafetyDepth());
  // Only a source that has actually published has a winning path worth asking the server about.
  const winningPath = $derived(depth.source === undefined ? undefined : depth.path);
  const localLimit = $derived(
    deps.thresholds.value.shallowDepthMeters ?? DEFAULT_THRESHOLDS.shallowDepthMeters,
  );

  // Server zones join in only when they carry an alarm band. A warning-only zone set would
  // otherwise disarm the alarm entirely, which is a silent safety regression.
  const serverZones = $derived.by<MetaZone[] | undefined>(() => {
    void metaCache.version;
    if (winningPath === undefined) return undefined;
    const zones = metaCache.get(winningPath)?.zones;
    if (!zones || zones.length === 0) return undefined;
    return zones.some((zone) => zone.state === 'alarm' || zone.state === 'emergency')
      ? zones
      : undefined;
  });

  // The server's deepest alarm bound, when its zones publish one.
  const serverLimitMeters = $derived(serverZones ? alarmBound(serverZones) : undefined);
  // The governing bound is the DEEPER of the server bound and the local threshold: for a shallow
  // alarm, firing earlier is the safe merge, so the server can never quietly loosen a limit the
  // skipper set deeper. An open-topped server alarm zone has no bound; the local number then
  // stands as the displayed limit while the zones still contribute to alarming below.
  const effectiveLimitMeters = $derived(
    serverLimitMeters === undefined ? localLimit : Math.max(serverLimitMeters, localLimit),
  );
  const thresholdSource = $derived<ShallowThresholdSource>(
    serverLimitMeters !== undefined && serverLimitMeters >= localLimit ? 'server' : 'local',
  );

  const monitorState = $derived.by<ShallowMonitorState>(() => {
    if (depth.source === undefined) return 'no-source';
    if (depth.stale) return 'stale';
    // Fresh frames carrying no usable number (bottom-lock loss) keep the cell live but the alarm
    // blind; claiming 'monitoring' then would hide exactly the blindness that matters.
    if (depth.meters === undefined) return 'no-reading';
    return 'monitoring';
  });

  const alarming = $derived.by(() => {
    const { meters, stale } = depth;
    if (stale) return false;
    // Either bound fires: the server's zone bands or the skipper's local threshold, whichever
    // reaches deeper. Without server zones the local predicate stands alone.
    if (isShallowAlarmActive(meters, stale, localLimit)) return true;
    return serverZones !== undefined && zoneStateFor(meters, serverZones) === 'alarm';
  });

  // The one depth notification the generic alarm should not double-sound: claimed only WHILE THIS
  // MONITOR IS ACTUALLY ALARMING, because that is the only moment two tones for one shoaling are
  // possible. Any divergence, a stale or null reading, cached zones drifting from the server's, a
  // threshold disagreement, leaves the claim released so the server's still-raised alarm reaches
  // the generic tone, strip, and badge. Erring to a brief double tone beats erring to silence.
  const ownedNotificationPath = $derived(
    serverZones !== undefined && winningPath !== undefined && alarming
      ? `${NOTIFICATIONS_PREFIX}${winningPath}`
      : undefined,
  );

  const alert = $derived.by(() => {
    if (monitorState === 'stale')
      return 'Depth data lost. Shallow-water monitoring is unavailable.';
    if (monitorState === 'no-reading')
      return 'Depth reading unavailable. Shallow-water monitoring is paused.';
    if (!alarming) return '';
    const unit = lengthUnit(deps.units.mode);
    const shown = formatLengthOr(depth.meters, deps.units.mode);
    // A server zone (an open-topped band, most often) can fire while the depth is not under the
    // displayed limit; naming that limit would then be false on its face.
    if (!isShallowAlarmActive(depth.meters, depth.stale, localLimit)) {
      return `Shallow water: depth ${shown} ${unit}, inside the server's depth alarm zone.`;
    }
    return `Shallow water: depth ${shown} ${unit}, under the ${formatLengthOr(effectiveLimitMeters, deps.units.mode)} ${unit} alarm threshold.`;
  });

  // Keyed on the path, the cache version, and (through the cache's token read) the auth token, so
  // a failed fetch re-enters when its paced retry window reopens while a 1 Hz depth sample never
  // does. The cache's per-path attempt cap bounds the resulting retries.
  $effect(() => {
    void metaCache.version;
    if (winningPath !== undefined) metaCache.load(winningPath);
  });

  $effect(() => {
    alarm.update(alarming);
  });

  return {
    // Silence the tone outright (teardown). There is no prime here: the app resumes one shared
    // audio context through primeAlarmAudio(), so a per-alarm prime would be dead weight.
    stop: () => alarm.stop(),
    // Drop cached depth-path meta so a server-side zone edit reaches the watch. Called on the
    // stream open edge, where a restarted or reconfigured server is exactly what may have changed.
    refreshMeta: () => metaCache.refresh(),
    get alarming() {
      return alarming;
    },
    get alert() {
      return alert;
    },
    get effectiveLimitMeters() {
      return effectiveLimitMeters;
    },
    get serverLimitMeters() {
      return serverLimitMeters;
    },
    get serverZonesActive() {
      return serverZones !== undefined;
    },
    get thresholdSource() {
      return thresholdSource;
    },
    get monitorState() {
      return monitorState;
    },
    get ownedNotificationPath() {
      return ownedNotificationPath;
    },
  };
}

// The slice of the controller the panel actually renders, grouped so one prop carries it across
// layers: nothing speculative rides along. serverZonesActive distinguishes zones with no nameable
// bound (an open-topped alarm band) from no zones at all, so the panel can still say the server is
// arming the alarm.
export interface ShallowMonitorSnapshot {
  monitorState: ShallowMonitorState;
  serverLimitMeters: number | undefined;
  serverZonesActive: boolean;
}

import type { UnitsStore } from '$entities/units';
import type { DepthReading } from '$entities/vessel';
import { type AlarmControl, GatedAlarm } from '$shared/audio';
import { formatLengthOr, lengthUnit } from '$shared/lib';
import type { PersistedValue, Thresholds } from '$shared/settings';
import {
  createPathMetaCache,
  type MetaZone,
  NOTIFICATIONS_PREFIX,
  zoneStateFor,
} from '$shared/signalk';
import {
  defaultShallowLimitMeters,
  isShallowAlarmActive,
  SHALLOW_DEGRADE_TONE,
  SHALLOW_TONE,
} from './shallow-alarm';

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
  // The declared draft (vessel.draftMeters), which shapes the DEFAULT threshold when the skipper
  // has not set one. A getter for the same reason as the depth: the declaration can arrive after
  // construction. Optional: without it the fixed default stands, as before draft was consumed.
  getDraftMeters?: () => number | undefined;
  thresholds: PersistedValue<Thresholds>;
  units: UnitsStore;
  origin: string;
  getToken: () => string | undefined;
  alarm?: AlarmControl;
  // A GatedAlarm on the coordinator's courtesy channel, sounding the bounded stand-down cue when
  // an armed watch stops monitoring. Optional: without it the edge is visual and spoken only,
  // which is what every caller had before the cue existed.
  degradeAlarm?: GatedAlarm;
}

// The stand-down cue is bounded: two couplets, then silence. The paused state itself stays on the
// chip and panel; the sound only marks the edge, like the weather warning chirp.
const DEGRADE_CHIRP_MS = 2 * SHALLOW_DEGRADE_TONE.periodMs;
// How long the transient stand-down announcement stays up for the live region.
const DEGRADE_NOTICE_MS = 12_000;

const DEGRADE_NOTICES: Record<Exclude<ShallowMonitorState, 'monitoring'>, string> = {
  stale: 'Shallow water watch paused: depth data lost.',
  'no-reading': 'Shallow water watch paused: no usable depth reading.',
  'no-source': 'Shallow water watch paused: the depth source stopped publishing.',
};

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
    deps.thresholds.value.shallowDepthMeters ?? defaultShallowLimitMeters(deps.getDraftMeters?.()),
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

  // The stand-down cue. Not seeded: a session that opens with no sounder never had a watch to
  // lose, so only a live watch pausing is the event. The chip alone is easy to miss on a dark
  // helm; the bounded chirp and the transient notice mark the edge, then the chip carries on.
  let degradeNotice = $state('');
  let wasMonitoring = false;
  let chirpTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  function clearDegradeCue(): void {
    clearTimeout(chirpTimer);
    clearTimeout(noticeTimer);
    deps.degradeAlarm?.update(false);
    degradeNotice = '';
  }

  $effect(() => {
    const state = monitorState;
    if (state === 'monitoring') {
      wasMonitoring = true;
      // Watching again: a lingering paused cue would contradict the chip.
      clearDegradeCue();
      return;
    }
    if (!wasMonitoring) return;
    wasMonitoring = false;
    degradeNotice = DEGRADE_NOTICES[state];
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (degradeNotice = ''), DEGRADE_NOTICE_MS);
    const cue = deps.degradeAlarm;
    if (cue) {
      // Always a rising edge: resuming monitoring is the only way back here, and it clears the cue.
      cue.update(true);
      clearTimeout(chirpTimer);
      chirpTimer = setTimeout(() => cue.update(false), DEGRADE_CHIRP_MS);
    }
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
    // Silence the tones outright (teardown). There is no prime here: the app resumes one shared
    // audio context through primeAlarmAudio(), so a per-alarm prime would be dead weight.
    stop: () => {
      alarm.stop();
      clearTimeout(chirpTimer);
      clearTimeout(noticeTimer);
      deps.degradeAlarm?.stop();
    },
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
    // The transient stand-down announcement, up briefly after an armed watch pauses, empty
    // otherwise. Distinct from `alert`, which holds for as long as the state does.
    get degradeNotice() {
      return degradeNotice;
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

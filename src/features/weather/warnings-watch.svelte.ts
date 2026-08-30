import type { AlarmTone, GatedAlarm } from '$shared/audio';
import type { LatLon } from '$shared/geo';
import { quantizeLatLonKey } from '$shared/geo';
import type { PointConditionsLoader } from './point-conditions';
import { WARNING_REFRESH_MS } from './point-conditions';
import type { WeatherProvider, WeatherWarning } from './signalk-weather';
import { normalizeWeatherWarnings, weatherWarningIdentity } from './signalk-weather';
import { activeWarnings } from './warning-severity';

// A single low couplet repeated briefly: an advisory cue, deliberately sparser and lower than the
// arrival couplet so a gale notice is never confused with either danger or arrival.
export const WEATHER_WARNING_TONE: AlarmTone = {
  frequency: 440,
  beepMs: 160,
  gapMs: 140,
  beeps: 2,
  periodMs: 3200,
  volume: 0.12,
};

// The audible cue is bounded: a provider warning is advisory context, not a condition to hold a
// tone on, so it chirps for two periods and stops. The chip and panel carry it from there.
const CHIRP_MS = 2 * WEATHER_WARNING_TONE.periodMs;

// Warnings are region-scale products, so the refetch cell is about 11 km (one decimal place);
// the panel's 110 m cell would refetch continuously on a boat under way.
const WATCH_CELL_DECIMALS = 1;

interface WeatherWarningsWatchDeps {
  origin: string;
  token: () => string | undefined;
  provider: () => WeatherProvider | undefined;
  // A fresh vessel fix, or undefined; a stale fix must not keep fetching warnings for water the
  // boat may have left.
  position: () => LatLon | undefined;
  loader: Pick<PointConditionsLoader, 'loadWarnings'>;
  // The shared reactive clock; the poll gate re-evaluates on its tick.
  clock: { readonly now: number };
  // A GatedAlarm on the coordinator's courtesy channel: the cue must never preempt a safety alarm.
  alarm: GatedAlarm;
  // True while a plugin-raised weather notification is active on the boat. The plugin already
  // alerts every station through the alarm lifecycle, so the courtesy tone and toast stand down
  // and only the chip renders; alerting twice for one gale teaches crews to ignore both.
  pluginAlertActive: () => boolean;
  announce: (message: string, ms?: number) => void;
}

const ANNOUNCE_MS = 12_000;

// Until a poll has succeeded, retries pace at a minute rather than the ten-minute cadence, so a
// flaky link at startup does not leave the boat unwarned for ten minutes, and a failing provider
// is still not hammered on every clock tick.
const UNPRIMED_RETRY_MS = 60_000;

// Watches the detected weather provider's warnings from the app shell, so a gale that activates
// while the weather panel is closed still reaches the helm: a courtesy tone, a transient toast,
// and a status chip. The open panel keeps its own richer list; this only covers the closed state.
export function createWeatherWarningsWatch(deps: WeatherWarningsWatchDeps) {
  let active = $state<WeatherWarning[]>([]);
  let generation = 0;
  let lastKey = '';
  let lastAttemptMs = 0;
  let seen = new Set<string>();
  let sessionPrimed = false;
  let chirpTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function chirp(): void {
    deps.alarm.update(true);
    deps.alarm.restart();
    clearTimeout(chirpTimer);
    chirpTimer = setTimeout(() => deps.alarm.update(false), CHIRP_MS);
  }

  async function refresh(provider: string | undefined, pos: LatLon, mine: number): Promise<void> {
    try {
      const point = await deps.loader.loadWarnings(
        deps.origin,
        provider,
        pos.latitude,
        pos.longitude,
        deps.token(),
      );
      if (disposed || mine !== generation) return;
      const current = activeWarnings(
        normalizeWeatherWarnings(point.warnings ?? []),
        deps.clock.now,
      );
      const identities = new Set(current.map(weatherWarningIdentity));
      const fresh = current.filter((warning) => !seen.has(weatherWarningIdentity(warning)));
      // Only currently active identities are remembered, so a warning that lapses and is later
      // reissued alerts again rather than being absorbed by a stale memory.
      seen = identities;
      active = current;
      if (fresh.length > 0 && !deps.pluginAlertActive()) {
        // The first answer of a session announces too: a gale already in effect when the app
        // opens is exactly what the watch exists to surface.
        deps.announce(
          fresh.length === 1
            ? `Weather warning: ${fresh[0].type}. Open Weather for details.`
            : `${fresh.length} weather warnings, worst ${fresh[0].type}. Open Weather for details.`,
          ANNOUNCE_MS,
        );
        chirp();
      }
      sessionPrimed = true;
    } catch {
      // A failed poll keeps the last list; the next tick retries. The panel owns richer
      // stale-versus-unavailable messaging.
    }
  }

  $effect(() => {
    const now = deps.clock.now;
    const provider = deps.provider();
    const pos = deps.position();
    // No provider still watches: the loader falls back to the free point-alert source, so a US
    // boat on a stock server hears about a gale too. A provider appearing or vanishing refetches.
    if (!pos) return;
    const key = `${provider?.id ?? 'nws'} ${quantizeLatLonKey(pos, WATCH_CELL_DECIMALS)}`;
    const cadence = sessionPrimed ? WARNING_REFRESH_MS : UNPRIMED_RETRY_MS;
    if (key === lastKey && now - lastAttemptMs < cadence) return;
    lastKey = key;
    lastAttemptMs = now;
    void refresh(provider?.id, pos, ++generation);
  });

  return {
    // Active warnings, severity-sorted; the chip renders the first.
    get active(): WeatherWarning[] {
      return active;
    },
    get headline(): string | undefined {
      return active.length > 0 ? active[0].type : undefined;
    },
    dispose(): void {
      disposed = true;
      generation += 1;
      clearTimeout(chirpTimer);
      deps.alarm.stop();
    },
  };
}

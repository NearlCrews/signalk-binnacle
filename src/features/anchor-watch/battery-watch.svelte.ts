import { formatPercent, isFiniteNumber, isRecord } from '$shared/lib';

// The slice of the Battery Status API manager this watch reads. Chromium only; everywhere else
// navigator.getBattery is absent and the watch stays silently off.
interface BatteryLike {
  charging: boolean;
  level: number;
  addEventListener(type: 'levelchange' | 'chargingchange', listener: () => void): void;
  removeEventListener(type: 'levelchange' | 'chargingchange', listener: () => void): void;
}

type BatteryWarningLevel = 'low' | 'critical';

// At or below these fractions of a full charge, a discharging device carrying a browser-only
// anchor watch gets warned: the watch dies with the device, silently.
export const BATTERY_LOW_FRACTION = 0.2;
export const BATTERY_CRITICAL_FRACTION = 0.1;

// The real navigator.getBattery, bound, or undefined wherever the API does not exist (every
// non-Chromium browser, and test environments without a navigator).
export function navigatorGetBattery(): (() => Promise<unknown>) | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const nav = navigator as Navigator & { getBattery?: () => Promise<unknown> };
  return nav.getBattery?.bind(nav);
}

function asBattery(value: unknown): BatteryLike | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.charging !== 'boolean' || !isFiniteNumber(value.level)) return undefined;
  if (
    typeof value.addEventListener !== 'function' ||
    typeof value.removeEventListener !== 'function'
  ) {
    return undefined;
  }
  return value as unknown as BatteryLike;
}

interface BatteryWatchDeps {
  // True while this browser is the alarm (a client-mode watch armed). The battery of a display
  // that only mirrors a server watch does not end the watch, so it is not watched.
  active: () => boolean;
  // navigator.getBattery where the browser offers one; injected for tests. Undefined is the
  // silent no-op everywhere the API is absent.
  getBattery: (() => Promise<unknown>) | undefined;
}

// Watches the device battery while a browser-only anchor watch is armed, so the crew hears about
// a dying phone before the watch dies with it. Every failure mode (no API, a rejected probe, an
// unexpected shape) is a silent no-op: battery insight is a courtesy, never an error source.
export function createBatteryWatch(deps: BatteryWatchDeps) {
  let level = $state<number | undefined>();
  let discharging = $state(false);

  $effect(() => {
    if (!deps.active()) return;
    const getBattery = deps.getBattery;
    if (!getBattery) return;
    let battery: BatteryLike | undefined;
    let disposed = false;
    const read = (): void => {
      if (!battery) return;
      level = battery.level;
      discharging = !battery.charging;
    };
    const subscribe = async (): Promise<void> => {
      let resolved: unknown;
      try {
        resolved = await getBattery();
      } catch {
        return;
      }
      // The watch may have disarmed while the probe was in flight; attaching then would leak
      // listeners past the teardown that already ran.
      if (disposed) return;
      battery = asBattery(resolved);
      if (!battery) return;
      read();
      battery.addEventListener('levelchange', read);
      battery.addEventListener('chargingchange', read);
    };
    void subscribe();
    return () => {
      disposed = true;
      battery?.removeEventListener('levelchange', read);
      battery?.removeEventListener('chargingchange', read);
      level = undefined;
      discharging = false;
    };
  });

  const warning = $derived.by<BatteryWarningLevel | undefined>(() => {
    if (!discharging || level === undefined) return undefined;
    if (level <= BATTERY_CRITICAL_FRACTION) return 'critical';
    if (level <= BATTERY_LOW_FRACTION) return 'low';
    return undefined;
  });

  const note = $derived.by<string | undefined>(() => {
    if (warning === undefined || level === undefined) return undefined;
    const percent = `${formatPercent(level)}%`;
    return warning === 'critical'
      ? `Battery critical (${percent}). This browser carries the anchor watch, which ends when the device shuts down. Plug it in now.`
      : `Battery low (${percent}). This browser carries the anchor watch, which ends if the device shuts down. Plug it in.`;
  });

  return {
    get warning(): BatteryWarningLevel | undefined {
      return warning;
    },
    get note(): string | undefined {
      return note;
    },
  };
}

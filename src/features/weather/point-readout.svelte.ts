import type { WeatherStore } from '$entities/weather';
import { GRID_SOURCE_LABEL } from './fills';
import {
  fetchObservations,
  fetchPointForecasts,
  NEAR_NOW_MS,
  nearestInTimeBounded,
  providerDisplayName,
  providerReadoutContribution,
} from './signalk-weather';
import { readoutAtBracket, type WeatherReadout } from './weather-readout';

export interface PointReadoutDeps {
  // Getters, not values, for the reactive inputs: the store is a stable instance but the token and the
  // provider name change over the session (re-auth, provider detection), so a tap must read them live.
  store: () => WeatherStore;
  // The Signal K server origin, captured once for the page lifetime.
  origin: string;
  // The Signal K auth token, when one is configured.
  token: () => string | undefined;
  fetchFn?: typeof fetch;
  // The default weather provider's display name, when one is configured. With a provider the tap
  // prefers it and falls back to the free grid; without one the grid answers.
  providerName: () => string | undefined;
  // The stable provider map key used to pin API requests. Kept separate from the display name.
  providerId?: () => string | undefined;
  // How many weather layers are on: the grid sample only shows when at least one is, matching the
  // overlays drawn under the finger.
  activeCount: () => number;
  // True once the host component has torn down, so a provider answer that resolves after teardown
  // does not write state.
  isDestroyed: () => boolean;
}

const READOUT_DISMISS_MS = 8000;

// Enough forecast steps to cover scrubbing past the panel window.
const TAP_FORECAST_COUNT = 48;

export function mergePointReadouts(
  provider: Partial<WeatherReadout> | undefined,
  grid: WeatherReadout | undefined,
  providerName: string,
): { value: WeatherReadout; source: string } | undefined {
  const merged: Partial<WeatherReadout> = { ...grid };
  let providerFields = 0;
  for (const [key, contribution] of Object.entries(provider ?? {})) {
    if (contribution === undefined) continue;
    providerFields += 1;
    Object.assign(merged, { [key]: contribution });
  }
  const { speedMs, fromRad } = merged;
  if (speedMs === undefined || fromRad === undefined) return undefined;
  const value: WeatherReadout = { ...merged, speedMs, fromRad };
  if (providerFields === 0) return { value, source: GRID_SOURCE_LABEL };
  const gridContributed = grid
    ? Object.keys(grid).some((key) => provider?.[key as keyof WeatherReadout] === undefined)
    : false;
  return {
    value,
    source: gridContributed ? `${providerName} + ${GRID_SOURCE_LABEL}` : providerName,
  };
}

export function isCurrentReadoutRequest(
  requestSequence: number,
  activeSequence: number,
  requestedTime: number,
  selectedTime: number,
): boolean {
  return requestSequence === activeSequence && requestedTime === selectedTime;
}

// The point-tap readout: the conditions at the tapped point for the selected time, with a fast grid
// sample shown immediately and a configured provider upgrading it when it answers. Owns the readout
// state and the dismiss timer; the host wires onTap, hold, release, and dismiss to the map and the
// readout card.
export function createPointReadout(deps: PointReadoutDeps) {
  let readout = $state<WeatherReadout | undefined>();
  let readoutSource = $state<string | undefined>();
  // A provider answer is pending and the grid had nothing to show meanwhile, so the tap must not
  // look dead on a slow boat link.
  let readoutPending = $state(false);
  let readoutTimer: ReturnType<typeof setTimeout> | undefined;
  // The pointer or focus is parked on the readout, so nothing (not even a provider upgrade landing
  // mid-read) may arm the dismiss timer until it leaves.
  let readoutHeld = false;
  // Each tap bumps this so a slow provider response from an earlier tap cannot overwrite a newer one.
  let tapSeq = 0;
  let tappedPoint: { lat: number; lon: number } | undefined;
  let requestedTime = 0;

  function clearReadoutTimer(): void {
    if (readoutTimer) clearTimeout(readoutTimer);
    readoutTimer = undefined;
  }

  function showReadout(value: WeatherReadout | undefined, source: string | undefined): void {
    clearReadoutTimer();
    readout = value;
    readoutSource = value ? source : undefined;
    if (value && !readoutHeld) readoutTimer = setTimeout(dismiss, READOUT_DISMISS_MS);
  }

  function dismiss(): void {
    clearReadoutTimer();
    readout = undefined;
    readoutSource = undefined;
    readoutPending = false;
  }

  // A slow reader must not lose the readout mid-read: hovering or focusing it parks the dismiss
  // timer, leaving restarts it.
  function hold(): void {
    readoutHeld = true;
    clearReadoutTimer();
  }

  function release(): void {
    readoutHeld = false;
    if (readout && !readoutTimer) readoutTimer = setTimeout(dismiss, READOUT_DISMISS_MS);
  }

  async function providerReadout(
    providerId: string,
    lat: number,
    lon: number,
    target: number,
  ): Promise<Partial<WeatherReadout> | undefined> {
    // selectedTime of 0 means no grid has seeded the slider yet: no meaningful target to query.
    if (target === 0) return undefined;
    if (Math.abs(target - Date.now()) < NEAR_NOW_MS) {
      const obs = await fetchObservations(
        deps.origin,
        providerId,
        lat,
        lon,
        deps.token(),
        deps.fetchFn,
      );
      const reading = obs ? providerReadoutContribution(obs) : undefined;
      if (reading && Object.values(reading).some((value) => value !== undefined)) return reading;
    }
    // Bounded: past the provider's horizon its last step must not answer for a time days away; the
    // caller falls back to the grid sample instead.
    const series = await fetchPointForecasts(
      deps.origin,
      providerId,
      lat,
      lon,
      TAP_FORECAST_COUNT,
      deps.token(),
      deps.fetchFn,
    );
    const step = series && nearestInTimeBounded(series, target);
    return step ? providerReadoutContribution(step) : undefined;
  }

  function mergeReadout(
    provider: Partial<WeatherReadout> | undefined,
    grid: WeatherReadout | undefined,
  ): { value: WeatherReadout; source: string } | undefined {
    const id = deps.providerId?.() ?? deps.providerName();
    const providerName = deps.providerId
      ? (deps.providerName() ?? (id ? providerDisplayName(id) : 'Weather provider'))
      : id
        ? providerDisplayName(id)
        : 'Weather provider';
    return mergePointReadouts(provider, grid, providerName);
  }

  // Conditions at the tapped point for the selected time. The free-grid sample (blended across the
  // time bracket, exactly as the fields are drawn) shows IMMEDIATELY; a configured provider then
  // upgrades it when it answers, so a slow boat link never leaves the tap looking dead.
  async function resolveTap(lng: number, lat: number, target: number): Promise<void> {
    const seq = ++tapSeq;
    const store = deps.store();
    requestedTime = target;
    const providerId = deps.providerId?.() ?? deps.providerName();
    const gridSample =
      deps.activeCount() > 0 && store.grid
        ? readoutAtBracket(store.grid, lng, lat, store.bracket)
        : undefined;
    if (!providerId) {
      showReadout(gridSample, gridSample ? GRID_SOURCE_LABEL : undefined);
      return;
    }
    if (gridSample) showReadout(gridSample, GRID_SOURCE_LABEL);
    else readoutPending = true;
    const provider = await providerReadout(providerId, lat, lng, target);
    if (
      deps.isDestroyed() ||
      !isCurrentReadoutRequest(seq, tapSeq, target, deps.store().selectedTime)
    ) {
      return;
    }
    readoutPending = false;
    const merged = mergeReadout(provider, gridSample);
    if (merged) showReadout(merged.value, merged.source);
    else if (!gridSample) dismiss();
  }

  async function onTap(lng: number, lat: number): Promise<void> {
    tappedPoint = { lat, lon: lng };
    return resolveTap(lng, lat, deps.store().selectedTime);
  }

  // Keep the last tapped point synchronized with time scrubbing. Starting the replacement request
  // increments tapSeq, so the old time can never land after the new one.
  $effect(() => {
    const target = deps.store().selectedTime;
    if (!tappedPoint || target === requestedTime) return;
    void resolveTap(tappedPoint.lon, tappedPoint.lat, target);
  });

  function destroy(): void {
    tapSeq += 1;
    tappedPoint = undefined;
    clearReadoutTimer();
  }

  return {
    onTap,
    hold,
    release,
    dismiss,
    destroy,
    get readout() {
      return readout;
    },
    get readoutSource() {
      return readoutSource;
    },
    get readoutPending() {
      return readoutPending;
    },
  };
}

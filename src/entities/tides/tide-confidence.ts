import { formatDayClock, formatMonthDay } from '$shared/lib';
import type { TidesStore } from './tides-store.svelte';
import type { TideReading } from './tides-types';

export function formatTideDatum(reading: Pick<TideReading, 'datum'> | undefined): string {
  return reading?.datum ? `Datum: ${reading.datum}` : 'Datum unknown';
}

export function formatTideEventTime(timeMs: number): string {
  return `${formatMonthDay(timeMs)} ${formatDayClock(timeMs, { zone: true })}`;
}

// Keep failed selection and source-time qualifiers ahead of station prose in bounded snapshots.
export function tideHandoffFact(store: TidesStore, nowMs: number): string {
  const failed = store.failures.map((failure) => {
    const requested =
      failure.requested.mode === 'manual' ? failure.requested.station.name : 'automatic station';
    return `${failure.kind} refresh failed (${requested})`;
  });
  const reading = store.tide;
  if (!reading && !store.current)
    return failed.join('; ') || (store.status === 'idle' ? 'not loaded' : store.status);
  const state =
    failed.length > 0
      ? `Retained; ${store.failures.map((failure) => failure.kind).join(' and ')} refresh failed`
      : store.status === 'loading'
        ? 'Retained while refreshing'
        : 'Predictions loaded';
  if (!reading)
    return `${state}; fetch time unknown; tide height unavailable; NOAA CO-OPS current station ${store.current?.station.name}; ${failed.join('; ')}`;
  const age =
    reading.fetchedAtMs !== undefined &&
    Number.isFinite(reading.fetchedAtMs) &&
    reading.fetchedAtMs >= 0 &&
    reading.fetchedAtMs <= nowMs
      ? `fetched ${formatTideEventTime(reading.fetchedAtMs)}`
      : 'fetch time unknown';
  const source = store.source === 'noaa-coops' ? 'NOAA CO-OPS' : (store.source ?? 'source unknown');
  return `${state}; ${age}; ${formatTideDatum(reading)}; ${source}, accepted ${reading.station.name}${failed.length ? `; ${failed.join('; ')}` : ''}`;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeatherStore } from '$entities/weather';
import { createForecastPlayback } from './playback.svelte';

afterEach(() => vi.useRealTimers());

describe('forecast return to now', () => {
  it('stops animation before restoring now within the accepted forecast range', () => {
    vi.useFakeTimers();
    const store = new WeatherStore();
    const playback = createForecastPlayback(
      () => store,
      () => ({ start: 100, end: 1_000, stepMs: 100 }),
      () => 550,
    );
    playback.toggle();
    expect(playback.playing).toBe(true);
    playback.returnToNow();
    expect(playback.playing).toBe(false);
    expect(store.selectedTime).toBe(550);
    vi.advanceTimersByTime(2_000);
    expect(store.selectedTime).toBe(550);
    playback.destroy();
  });

  it('bounds now to the available data without inventing a forecast', () => {
    const store = new WeatherStore();
    const playback = createForecastPlayback(
      () => store,
      () => ({ start: 100, end: 1_000, stepMs: 100 }),
      () => 5_000,
    );
    playback.returnToNow();
    expect(store.selectedTime).toBe(1_000);
    playback.destroy();
  });
});

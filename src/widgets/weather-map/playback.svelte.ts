import type { WeatherStore } from '$entities/weather';
import { advancePlay, clampTime, stepTime, type TimeRange } from '$features/weather';

// How long each playback frame holds before advancing to the next forecast step.
const PLAY_INTERVAL_MS = 700;

// The forecast-scrubber playback: owns whether the loop is running and its timer, and drives the
// selected time on the store. The time range is injected as a getter because it derives from the
// store's grid in the host and changes as the grid loads.
export function createForecastPlayback(
  getStore: () => WeatherStore,
  range: () => TimeRange | undefined,
  now: () => number = Date.now,
) {
  let playing = $state(false);
  let playTimer: ReturnType<typeof setInterval> | undefined;

  function stopPlay(): void {
    playing = false;
    if (playTimer) clearInterval(playTimer);
    playTimer = undefined;
  }

  function setTime(t: number): void {
    // A manual scrub or step takes the wheel: the play timer must not yank the thumb back.
    stopPlay();
    const r = range();
    if (r) getStore().setSelectedTime(clampTime(t, r));
  }

  function step(dir: 1 | -1): void {
    const r = range();
    if (r) setTime(stepTime(getStore().selectedTime, dir, r));
  }

  function toggle(): void {
    const r = range();
    if (playing || !r) {
      stopPlay();
      return;
    }
    playing = true;
    playTimer = setInterval(() => {
      const current = range();
      if (current) getStore().setSelectedTime(advancePlay(getStore().selectedTime, current));
    }, PLAY_INTERVAL_MS);
  }

  function destroy(): void {
    stopPlay();
  }

  return {
    toggle,
    setTime,
    returnToNow: () => setTime(now()),
    step,
    destroy,
    get playing() {
      return playing;
    },
  };
}

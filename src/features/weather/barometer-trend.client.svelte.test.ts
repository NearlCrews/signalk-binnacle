import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { MINUTE_MS } from '$shared/lib';
import { createBarometerTrend } from './barometer-trend.svelte';

const NOW = Date.parse('2026-08-30T12:00:00Z');

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup() {
  const state = $state({ now: NOW, pa: 101_300 as number | undefined, stale: false });
  let trend!: ReturnType<typeof createBarometerTrend>;
  let disposeRoot!: () => void;
  flushSync(() => {
    disposeRoot = $effect.root(() => {
      trend = createBarometerTrend({
        clock: state,
        pressurePa: () => state.pa,
        stale: () => state.stale,
      });
    });
  });
  cleanups.push(() => disposeRoot());
  return { state, trend };
}

// Advance the clock a minute per tick, applying the pressure for each minute.
function advance(
  state: { now: number; pa: number | undefined },
  minutes: number,
  paAt: (minute: number) => number,
): void {
  for (let minute = 1; minute <= minutes; minute += 1) {
    state.now += MINUTE_MS;
    state.pa = paAt(minute);
    flushSync();
  }
}

describe('createBarometerTrend', () => {
  it('stays undefined under an hour, then reports a provisional tendency at the 3-hour pace', () => {
    const { state, trend } = setup();
    advance(state, 59, () => 101_300);
    expect(trend.tendency).toBeUndefined();
    advance(state, 1, () => 101_300);
    expect(trend.tendency).toMatchObject({ provisional: true, grade: 'steady' });

    // A 200 Pa fall over the first hour is a 600 Pa per 3 h pace: the fast caution, provisional.
    const falling = setup();
    advance(falling.state, 60, (minute) => 101_300 - (200 * minute) / 60);
    expect(falling.trend.tendency).toMatchObject({ provisional: true, grade: 'falling-fast' });
    expect(falling.trend.tendency?.ratePa3h).toBeCloseTo(-600, 6);
  });

  it('grades the trailing 3-hour window, not the whole session', () => {
    const { state, trend } = setup();
    advance(state, 180, () => 101_300);
    expect(trend.tendency).toMatchObject({ provisional: false, grade: 'steady' });
    // Steady for 3 h, then 2 Pa per minute down: the tendency reads the fall alone.
    advance(state, 180, (minute) => 101_300 - 2 * minute);
    expect(trend.tendency?.ratePa3h).toBeCloseTo(-360, 3);
    expect(trend.tendency).toMatchObject({ provisional: false, grade: 'falling' });
  });

  it('grades a rise symmetrically', () => {
    const { state, trend } = setup();
    advance(state, 180, (minute) => 101_300 + 2 * minute);
    expect(trend.tendency).toMatchObject({ provisional: false, grade: 'rising' });
  });

  it('records neither stale readings nor implausible values', () => {
    const { state, trend } = setup();
    advance(state, 90, () => 101_300);
    state.stale = true;
    advance(state, 90, () => 90_000);
    state.stale = false;
    // A barometer publishing hectopascals as Pascals must not poison the tendency.
    advance(state, 60, () => 1_013);
    expect(trend.tendency).toMatchObject({ provisional: true, grade: 'steady' });
    expect(trend.tendency?.spanMs).toBe(90 * MINUTE_MS);
  });

  it('restarts the history when the clock steps backward', () => {
    const { state, trend } = setup();
    advance(state, 120, () => 101_300);
    expect(trend.tendency).toBeDefined();
    state.now -= 180 * MINUTE_MS;
    flushSync();
    expect(trend.tendency).toBeUndefined();
  });
});

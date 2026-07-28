import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryProviders } from '$shared/signalk';
import type { loadTimeTravelHistory, TimeTravelData } from './time-travel-client';
import { createTimeTravelController } from './time-travel-controller.svelte';
import { timeTravelPreset } from './time-travel-presets';

class FakeVisibility {
  hidden = false;
  listeners = new Set<() => void>();

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.delete(listener);
  }

  dispatch(): void {
    for (const listener of this.listeners) listener();
  }
}

class FakeMotion {
  matches = false;
  listeners = new Set<(event: { matches: boolean }) => void>();

  addEventListener(_type: 'change', listener: (event: { matches: boolean }) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'change', listener: (event: { matches: boolean }) => void): void {
    this.listeners.delete(listener);
  }

  set(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) listener({ matches });
  }
}

const providers: HistoryProviders = { ids: ['provider-a'] };

function data(
  rangeId: '1h' | '6h' | '24h' | '7d' = '24h',
  times: number[] = [0, 60_000, 120_000],
  provider = 'provider-a',
): TimeTravelData {
  return {
    provider,
    preset: timeTravelPreset(rangeId),
    from: times[0] ?? 0,
    to: times.at(-1) ?? 0,
    samples: times.map((t, index) => ({
      t,
      lon: index + 1,
      lat: index + 1,
      depth: index + 1,
    })),
  };
}

function make(
  load: typeof loadTimeTravelHistory,
  getProviders: () => HistoryProviders | undefined = () => providers,
) {
  const visibility = new FakeVisibility();
  const motion = new FakeMotion();
  const controller = createTimeTravelController('http://x', () => 'token', getProviders, {
    load,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    getDocument: () => visibility,
    getMotionSource: () => motion,
  });
  return { controller, visibility, motion };
}

describe('createTimeTravelController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enters with the default range and starts at the newest loaded sample', async () => {
    const load = vi.fn<typeof loadTimeTravelHistory>().mockResolvedValue(data());
    const { controller } = make(load);
    await controller.enter();
    expect(load.mock.calls[0][3].preset.id).toBe('24h');
    expect(controller.status).toBe('ready');
    expect(controller.rangeId).toBe('24h');
    expect(controller.scrubMs).toBe(120_000);
    expect(controller.current?.t).toBe(120_000);
    controller.dispose();
  });

  it('reports a missing provider without starting a query', async () => {
    const load = vi.fn<typeof loadTimeTravelHistory>();
    const { controller } = make(load, () => ({ ids: [] }));
    await controller.enter();
    expect(controller.status).toBe('no-provider');
    expect(load).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('atomically changes ranges and preserves the scrub or loaded edge', async () => {
    const load = vi
      .fn<typeof loadTimeTravelHistory>()
      .mockImplementation(async (_origin, _token, _providers, request) =>
        request.preset.id === '24h'
          ? data('24h', [0, 60_000, 120_000])
          : data('7d', [0, 60_000, 120_000, 180_000]),
      );
    const { controller } = make(load);
    await controller.enter();
    await controller.setRange('7d');
    expect(controller.rangeId).toBe('7d');
    expect(controller.scrubMs).toBe(180_000);

    controller.setScrub(60_000);
    await controller.setRange('24h');
    expect(controller.scrubMs).toBe(60_000);
    controller.dispose();
  });

  it('retains accepted data when a range is empty or fails', async () => {
    const load = vi
      .fn<typeof loadTimeTravelHistory>()
      .mockResolvedValueOnce(data())
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...data('7d', []), from: 0, to: 604_800_000 });
    const { controller } = make(load);
    await controller.enter();
    const accepted = controller.accepted;
    await controller.setRange('7d');
    expect(controller.accepted).toBe(accepted);
    expect(controller.rangeId).toBe('24h');
    expect(controller.error).toEqual({ kind: 'failed', rangeId: '7d' });
    await controller.setRange('7d');
    expect(controller.accepted).toBe(accepted);
    expect(controller.error).toEqual({ kind: 'empty', rangeId: '7d' });
    controller.dispose();
  });

  it('retries the failed range when the previously accepted range is empty', async () => {
    const load = vi
      .fn<typeof loadTimeTravelHistory>()
      .mockResolvedValueOnce({ ...data('24h', []), from: 0, to: 86_400_000 })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(data('7d'));
    const { controller } = make(load);
    await controller.enter();
    await controller.setRange('7d');
    expect(controller.error).toEqual({ kind: 'failed', rangeId: '7d' });

    await controller.retry();

    expect(load.mock.calls.at(-1)?.[3].preset.id).toBe('7d');
    expect(controller.rangeId).toBe('7d');
    controller.dispose();
  });

  it('keeps accepted data visible during refresh and preserves a non-edge scrub', async () => {
    let resolveRefresh: ((value: TimeTravelData) => void) | undefined;
    const refresh = new Promise<TimeTravelData>((resolve) => {
      resolveRefresh = resolve;
    });
    const load = vi
      .fn<typeof loadTimeTravelHistory>()
      .mockResolvedValueOnce(data())
      .mockReturnValueOnce(refresh);
    const { controller } = make(load);
    await controller.enter();
    controller.setScrub(60_000);
    const reloading = controller.reload();
    expect(controller.refreshing).toBe(true);
    expect(controller.samples).toHaveLength(3);
    resolveRefresh?.(data('24h', [0, 60_000, 120_000, 180_000]));
    await reloading;
    expect(controller.refreshing).toBe(false);
    expect(controller.scrubMs).toBe(60_000);
    controller.dispose();
  });

  it('aborts a superseded range and rejects its late result', async () => {
    let resolveFirst: ((value: TimeTravelData) => void) | undefined;
    const first = new Promise<TimeTravelData>((resolve) => {
      resolveFirst = resolve;
    });
    const load = vi
      .fn<typeof loadTimeTravelHistory>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(data('7d', [10, 20], 'provider-b'));
    const { controller } = make(load);
    const entering = controller.enter();
    const firstSignal = load.mock.calls[0][3].signal;
    const changing = controller.setRange('7d');
    expect(firstSignal?.aborted).toBe(true);
    resolveFirst?.(data());
    await Promise.all([entering, changing]);
    expect(controller.rangeId).toBe('7d');
    expect(controller.accepted?.provider).toBe('provider-b');
    controller.dispose();
  });

  it('plays accepted sample times, changes speed with one timer, and stops at the end', async () => {
    const load = vi
      .fn<typeof loadTimeTravelHistory>()
      .mockResolvedValue(data('24h', [0, 15 * 60_000, 30 * 60_000]));
    const { controller } = make(load);
    await controller.enter();
    controller.play();
    expect(controller.playing).toBe(true);
    expect(controller.scrubMs).toBe(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.setSpeed(2);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(350);
    expect(controller.scrubMs).toBe(15 * 60_000);
    await vi.advanceTimersByTimeAsync(350);
    expect(controller.scrubMs).toBe(30 * 60_000);
    expect(controller.playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    controller.dispose();
  });

  it('steps in the requested direction even when accepted samples are sparse', async () => {
    const load = vi
      .fn<typeof loadTimeTravelHistory>()
      .mockResolvedValue(data('24h', [0, 12 * 60 * 60_000, 24 * 60 * 60_000]));
    const { controller } = make(load);
    await controller.enter();
    controller.step(-1);
    expect(controller.scrubMs).toBe(12 * 60 * 60_000);
    controller.step(-1);
    expect(controller.scrubMs).toBe(0);
    controller.step(1);
    expect(controller.scrubMs).toBe(12 * 60 * 60_000);
    controller.dispose();
  });

  it('manual actions, hidden documents, and reduced motion pause without auto-resuming', async () => {
    const load = vi
      .fn<typeof loadTimeTravelHistory>()
      .mockResolvedValue(data('24h', [0, 15 * 60_000, 30 * 60_000]));
    const { controller, visibility, motion } = make(load);
    await controller.enter();
    controller.play();
    controller.setScrub(15 * 60_000);
    expect(controller.playing).toBe(false);

    controller.play();
    visibility.hidden = true;
    visibility.dispatch();
    expect(controller.playing).toBe(false);
    visibility.hidden = false;
    visibility.dispatch();
    expect(controller.playing).toBe(false);

    controller.play();
    motion.set(true);
    expect(controller.playing).toBe(false);
    expect(controller.reducedMotion).toBe(true);
    motion.set(false);
    expect(controller.playing).toBe(false);
    controller.dispose();
  });

  it('hides a stale marker and tears down requests, timers, and listeners on exit', async () => {
    const load = vi
      .fn<typeof loadTimeTravelHistory>()
      .mockResolvedValue(data('1h', [0, 10 * 60_000]));
    const { controller, visibility, motion } = make(load);
    await controller.enter();
    controller.setScrub(5 * 60_000);
    expect(controller.current).toBeUndefined();
    expect(controller.markerSample).toBeUndefined();

    controller.play();
    controller.exit();
    expect(controller.active).toBe(false);
    expect(controller.status).toBe('idle');
    expect(controller.samples).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(visibility.listeners.size).toBe(0);
    expect(motion.listeners.size).toBe(0);
    controller.dispose();
  });
});

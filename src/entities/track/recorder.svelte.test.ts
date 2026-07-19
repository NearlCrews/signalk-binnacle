import { describe, expect, it, vi } from 'vitest';
import { createTrackSettings } from '$shared/settings';
import { createTrackStore } from '$shared/storage';
import { createFakeStorage } from '$shared/testing';
import { computeStats, decideRecord, TrackRecorder } from './recorder.svelte';
import type { TrackPoint } from './track-types';

function recorder(): TrackRecorder {
  return new TrackRecorder(
    createTrackSettings(createFakeStorage()),
    createTrackStore<TrackPoint>(undefined),
  );
}

const defaults = { intervalSeconds: 10, minMeters: 10, colorMode: 'speed' as const };
const MAX_DATE_MS = 8_640_000_000_000_000;

describe('decideRecord', () => {
  it('records the first fix with no gap', () => {
    expect(decideRecord(undefined, undefined, 36.8, -121.7, 0, defaults)).toEqual({
      append: true,
      gap: false,
    });
  });

  it('skips a fix under the interval or under the min distance', () => {
    const last: TrackPoint = { lat: 36.8, lon: -121.7, t: 0, sog: 1 };
    expect(decideRecord(last, 0, 36.80001, -121.7, 5000, defaults).append).toBe(false); // 5 s, ~1 m
    expect(decideRecord(last, 0, 36.801, -121.7, 5000, defaults).append).toBe(false); // 111 m but only 5 s
  });

  it('records once both interval and distance pass', () => {
    const last: TrackPoint = { lat: 36.8, lon: -121.7, t: 0, sog: 1 };
    expect(decideRecord(last, 0, 36.801, -121.7, 12000, defaults)).toEqual({
      append: true,
      gap: false,
    });
  });

  it('records with a break after a genuine fix-stream outage', () => {
    const last: TrackPoint = { lat: 36.8, lon: -121.7, t: 0, sog: 1 };
    // The last considered fix was 6 minutes ago: a real GPS dropout.
    expect(decideRecord(last, 0, 36.8, -121.7, 6 * 60 * 1000, defaults)).toEqual({
      append: true,
      gap: true,
    });
    // No considered-fix time known (a restored track): fall back to the recorded point's time.
    expect(decideRecord(last, undefined, 36.8, -121.7, 6 * 60 * 1000, defaults)).toEqual({
      append: true,
      gap: true,
    });
  });

  it('starts a break after an implausible GPS jump', () => {
    const last: TrackPoint = { lat: 36.8, lon: -121.7, t: 0, sog: 1 };
    expect(
      decideRecord(last, 0, 37.8, -121.7, 1000, defaults, {
        lat: 36.8,
        lon: -121.7,
        t: 0,
      }),
    ).toEqual({ append: true, gap: true });
  });

  it('does not gap a stationary boat whose fix stream is continuous', () => {
    const last: TrackPoint = { lat: 36.8, lon: -121.7, t: 0, sog: 0 };
    // Fixes kept arriving (the latest one minute ago); long-since-recorded is not a dropout,
    // and the min-move threshold vetoes the stationary append.
    expect(decideRecord(last, 5 * 60 * 1000, 36.8, -121.7, 6 * 60 * 1000, defaults)).toEqual({
      append: false,
      gap: false,
    });
  });
});

describe('computeStats', () => {
  it('sums non-gap distance, duration, and max sog', () => {
    const stats = computeStats([
      { lat: 0, lon: 0, t: 0, sog: 1 },
      { lat: 0.001, lon: 0, t: 10_000, sog: 3 },
    ]);
    expect(stats.distanceMeters).toBeCloseTo(111.19, 0);
    expect(stats.durationSeconds).toBe(10);
    expect(stats.maxSog).toBe(3);
  });

  it('excludes a gap segment from distance', () => {
    const stats = computeStats([
      { lat: 0, lon: 0, t: 0, sog: 1 },
      { lat: 1, lon: 0, t: 1000, sog: 1, gap: true },
    ]);
    expect(stats.distanceMeters).toBe(0);
  });
});

describe('TrackRecorder', () => {
  it('records on policy and exposes stats', () => {
    const r = recorder();
    r.consider(36.8, -121.7, 1, 0);
    r.consider(36.80001, -121.7, 1, 5000); // too soon and too close
    r.consider(36.801, -121.7, 2, 12000); // 12 s, 111 m
    expect(r.points.map((p) => p.t)).toEqual([0, 12000]);
    expect(r.stats.maxSog).toBe(2);
  });

  it('records nothing after the first point at anchor with continuous fixes', () => {
    const r = recorder();
    // A fix every minute at the same position for half an hour: the min-move check vetoes
    // every append, and the continuous stream means no gap point is ever recorded.
    for (let t = 0; t <= 30 * 60 * 1000; t += 60 * 1000) {
      r.consider(36.8, -121.7, 0, t);
    }
    expect(r.points.length).toBe(1);
  });

  it('starts a break after a genuine fix-stream outage', () => {
    const r = recorder();
    r.consider(36.8, -121.7, 1, 0);
    r.consider(36.8, -121.7, 1, 6 * 60 * 1000); // first fix after a 6-minute GPS outage
    expect(r.points.length).toBe(2);
    expect(r.points[1].gap).toBe(true);
  });

  it('marks a break on resume', () => {
    const r = recorder();
    r.consider(36.8, -121.7, 1, 0);
    r.pause();
    r.consider(36.9, -121.7, 1, 12000); // dropped while paused
    r.resume();
    r.consider(36.81, -121.7, 1, 24000);
    expect(r.points.length).toBe(2);
    expect(r.points[1].gap).toBe(true);
  });

  it('clear empties the track', () => {
    const r = recorder();
    r.consider(36.8, -121.7, 1, 0);
    r.clear();
    expect(r.points).toEqual([]);
  });

  it('rejects invalid fixes and normalizes negative SOG', () => {
    const r = recorder();
    r.consider(91, 0, 1, 1);
    r.consider(0, 181, 1, 2);
    r.consider(0, 0, Number.NaN, 3);
    r.consider(0, 0, -2, 4);
    expect(r.points).toHaveLength(1);
    expect(r.points[0].sog).toBe(0);
  });

  it('keeps clear authoritative when restore resolves later', async () => {
    let resolveAll!: (points: TrackPoint[]) => void;
    const store = {
      all: () => new Promise<TrackPoint[]>((resolve) => (resolveAll = resolve)),
      append: async () => {},
      clear: async () => {},
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    r.clear();
    resolveAll([{ lat: 1, lon: 1, t: 1, sog: 1 }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.points).toEqual([]);
    expect(r.restored).toBe(true);
  });

  it('serializes append before clear in persistent storage', async () => {
    const operations: string[] = [];
    const store = {
      all: async () => [],
      append: async () => {
        operations.push('append');
      },
      clear: async () => {
        operations.push('clear');
      },
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    r.consider(1, 1, 1, 1);
    r.clear();
    await vi.waitFor(() => expect(operations).toEqual(['append', 'clear']));
  });

  it('keeps fixes captured after the saved prefix and rewrites persistence', async () => {
    const persisted: TrackPoint[] = [];
    const store = {
      all: async () => [],
      append: async (point: TrackPoint) => {
        persisted.push(point);
      },
      clear: async () => {
        persisted.length = 0;
      },
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    r.consider(1, 1, 1, 1);
    r.consider(1.001, 1, 1, 12_000);
    r.consider(1.002, 1, 1, 24_000);
    r.clearThrough(12_000);
    expect(r.points.map((point) => point.t)).toEqual([24_000]);
    await vi.waitFor(() => expect(persisted.map((point) => point.t)).toEqual([24_000]));
  });

  it('restores persisted points from the store on construction', async () => {
    const seeded: TrackPoint[] = [
      { lat: 36.8, lon: -121.7, t: 0, sog: 1 },
      { lat: 36.81, lon: -121.7, t: 12000, sog: 2 },
    ];
    const store = {
      all: async () => seeded.slice(),
      append: async () => {},
      clear: async () => {},
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    // #restore runs asynchronously in the constructor; let its microtasks settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(r.points).toEqual(seeded);
    expect(r.restored).toBe(true);
  });

  it('coerces a restored point with no sog to zero so every reader sees a number', async () => {
    // A point persisted by an older build can lack sog; TrackPoint.sog is typed number, and the
    // speed-colored track line and the stats both read it as one.
    const legacy = [{ lat: 36.8, lon: -121.7, t: 0 } as unknown as TrackPoint];
    const store = {
      all: async () => legacy,
      append: async () => {},
      clear: async () => {},
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    // #restore runs asynchronously in the constructor; let its microtasks settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(r.points[0].sog).toBe(0);
  });

  it('drops corrupt restored coordinates and normalizes invalid SOG', async () => {
    const store = {
      all: async () => [
        { lat: 100, lon: 1, t: 0, sog: 1 },
        { lat: 1, lon: 1, t: 1, sog: -5 },
      ],
      append: async () => {},
      clear: async () => {},
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.points).toEqual([{ lat: 1, lon: 1, t: 1, sog: 0 }]);
  });

  it('keeps fixes recorded before the restore resolves', async () => {
    let resolveAll!: (points: TrackPoint[]) => void;
    const store = {
      all: () =>
        new Promise<TrackPoint[]>((resolve) => {
          resolveAll = resolve;
        }),
      append: async () => {},
      clear: async () => {},
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    r.consider(36.8, -121.7, 1, 20000); // a live fix lands before the store read finishes
    resolveAll([{ lat: 36.7, lon: -121.7, t: 0, sog: 1 }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.points.map((p) => p.t)).toEqual([0, 20000]);
  });

  it('marks a late-restored startup junction as a gap after app downtime', async () => {
    let resolveAll!: (points: TrackPoint[]) => void;
    const store = {
      all: () => new Promise<TrackPoint[]>((resolve) => (resolveAll = resolve)),
      append: async () => {},
      clear: async () => {},
    };
    const now = Date.now();
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    r.consider(36.9, -121.7, 1, now);
    resolveAll([{ lat: 36.8, lon: -121.7, t: now - 10 * 60 * 1000, sog: 1 }]);

    await vi.waitFor(() => expect(r.restored).toBe(true));

    expect(r.points).toHaveLength(2);
    expect(r.points[1].gap).toBe(true);
    expect(r.stats.distanceMeters).toBe(0);
  });

  it('rejects non-monotonic restored timestamps without discarding a future clock epoch', async () => {
    const now = Date.now();
    const store = {
      all: async () => [
        { lat: 1, lon: 1, t: 100, sog: 1 },
        { lat: 2, lon: 2, t: 90, sog: 1 },
        { lat: 3, lon: 3, t: 100, sog: 1 },
        { lat: 4, lon: 4, t: now + 60_000, sog: 1 },
        { lat: 5, lon: 5, t: 110, sog: 1 },
      ],
      append: async () => {},
      clear: async () => {},
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    await vi.waitFor(() => expect(r.restored).toBe(true));
    expect(r.points.map((point) => point.t)).toEqual([100, now + 60_000]);
  });

  it('rejects restored timestamps at or beyond the terminal JavaScript date boundary', async () => {
    const store = {
      all: async () => [
        { lat: 1, lon: 1, t: Number.MAX_VALUE, sog: 1 },
        { lat: 1.5, lon: 1.5, t: MAX_DATE_MS, sog: 1 },
        { lat: 2, lon: 2, t: 100, sog: 1 },
      ],
      append: async () => {},
      clear: async () => {},
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    await vi.waitFor(() => expect(r.restored).toBe(true));
    expect(r.points.map((point) => point.t)).toEqual([100]);
  });

  it('restarts and persists a usable timeline when the restored clock cannot advance', async () => {
    const persisted: TrackPoint[] = [{ lat: 1, lon: 1, t: MAX_DATE_MS - 1, sog: 1 }];
    const store = {
      all: async () => persisted.map((point) => ({ ...point })),
      append: async (point: TrackPoint) => {
        persisted.push({ ...point });
      },
      clear: async () => {
        persisted.length = 0;
      },
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    await vi.waitFor(() => expect(r.restored).toBe(true));

    r.consider(2, 2, 2, 1_000_000);

    expect(r.points.map((point) => point.t)).toEqual([1_000_000]);
    await vi.waitFor(() => expect(persisted.map((point) => point.t)).toEqual([1_000_000]));

    const reloaded = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    await vi.waitFor(() => expect(reloaded.restored).toBe(true));
    expect(reloaded.points.map((point) => point.t)).toEqual([1_000_000]);
  });

  it('keeps live startup fixes when a late restored clock cannot be rebased safely', async () => {
    let resolveAll!: (points: TrackPoint[]) => void;
    const terminalPoint: TrackPoint = { lat: 2, lon: 2, t: MAX_DATE_MS - 1, sog: 1 };
    const persisted: TrackPoint[] = [{ ...terminalPoint }];
    const store = {
      all: () => new Promise<TrackPoint[]>((resolve) => (resolveAll = resolve)),
      append: async (point: TrackPoint) => {
        persisted.push({ ...point });
      },
      clear: async () => {
        persisted.length = 0;
      },
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    r.consider(1, 1, 1, 1_000_000);
    resolveAll([{ ...terminalPoint }]);
    await vi.waitFor(() => expect(r.restored).toBe(true));

    r.consider(1.001, 1, 1, 1_012_000);

    expect(r.points.map((point) => point.t)).toEqual([1_000_000, 1_012_000]);
    await vi.waitFor(() =>
      expect(persisted.map((point) => point.t)).toEqual([1_000_000, 1_012_000]),
    );

    const reloaded = new TrackRecorder(createTrackSettings(createFakeStorage()), {
      ...store,
      all: async () => persisted.map((point) => ({ ...point })),
    });
    await vi.waitFor(() => expect(reloaded.restored).toBe(true));
    expect(reloaded.points.map((point) => point.t)).toEqual([1_000_000, 1_012_000]);
  });

  it('falls back when an unsafe rebase offset would collapse timestamps', async () => {
    let resolveAll!: (points: TrackPoint[]) => void;
    const terminalPoint: TrackPoint = { lat: 2, lon: 2, t: MAX_DATE_MS - 1, sog: 1 };
    const liveT = -MAX_DATE_MS + 3;
    const persisted: TrackPoint[] = [{ ...terminalPoint }];
    const store = {
      all: () => new Promise<TrackPoint[]>((resolve) => (resolveAll = resolve)),
      append: async (point: TrackPoint) => {
        persisted.push({ ...point });
      },
      clear: async () => {
        persisted.length = 0;
      },
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    r.consider(1, 1, 1, liveT);
    resolveAll([{ ...terminalPoint }]);
    await vi.waitFor(() => expect(r.restored).toBe(true));

    expect(r.points.map((point) => point.t)).toEqual([liveT]);
    await vi.waitFor(() => expect(persisted.map((point) => point.t)).toEqual([liveT]));

    const reloaded = new TrackRecorder(createTrackSettings(createFakeStorage()), {
      ...store,
      all: async () => persisted.map((point) => ({ ...point })),
    });
    await vi.waitFor(() => expect(reloaded.restored).toBe(true));
    expect(reloaded.points.map((point) => point.t)).toEqual([liveT]);
  });

  it('recovers a paused fix from a restored clock that cannot advance', async () => {
    let resolveAll!: (points: TrackPoint[]) => void;
    const terminalPoint: TrackPoint = { lat: 2, lon: 2, t: MAX_DATE_MS - 1, sog: 1 };
    const persisted: TrackPoint[] = [{ ...terminalPoint }];
    const store = {
      all: () => new Promise<TrackPoint[]>((resolve) => (resolveAll = resolve)),
      append: async (point: TrackPoint) => {
        persisted.push({ ...point });
      },
      clear: async () => {
        persisted.length = 0;
      },
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    r.pause();
    r.consider(1, 1, 1, 1_000_000);
    resolveAll([{ ...terminalPoint }]);
    await vi.waitFor(() => expect(r.restored).toBe(true));
    await vi.waitFor(() => expect(persisted).toEqual([]));

    r.resume();
    r.consider(1.001, 1, 2, 1_012_000);

    expect(r.points.map((point) => point.t)).toEqual([1_012_000]);
    await vi.waitFor(() => expect(persisted.map((point) => point.t)).toEqual([1_012_000]));
  });

  it('rewrites a restored timestamp collision with the authoritative live point', async () => {
    let resolveAll!: (points: TrackPoint[]) => void;
    const persisted: TrackPoint[] = [{ lat: 2, lon: 2, t: 1_000_000, sog: 1 }];
    const store = {
      all: () => new Promise<TrackPoint[]>((resolve) => (resolveAll = resolve)),
      append: async (point: TrackPoint) => {
        persisted.push({ ...point });
      },
      clear: async () => {
        persisted.length = 0;
      },
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    r.consider(1, 1, 2, 1_000_000);
    resolveAll([{ lat: 2, lon: 2, t: 1_000_000, sog: 1 }]);
    await vi.waitFor(() => expect(r.restored).toBe(true));

    expect(r.points).toEqual([{ lat: 1, lon: 1, t: 1_000_000, sog: 2 }]);
    await vi.waitFor(() => expect(persisted).toEqual(r.points));
  });

  it('merges an earlier late restore chronologically', async () => {
    let resolveAll!: (points: TrackPoint[]) => void;
    const store = {
      all: () => new Promise<TrackPoint[]>((resolve) => (resolveAll = resolve)),
      append: async () => {},
      clear: async () => {},
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    r.consider(1, 1, 1, 10_000);
    resolveAll([{ lat: 2, lon: 2, t: 5_000, sog: 1 }]);
    await vi.waitFor(() => expect(r.restored).toBe(true));
    expect(r.points.map((point) => point.t)).toEqual([5_000, 10_000]);
  });

  it('starts a monotonic new segment when the wall clock regresses', () => {
    const r = recorder();
    r.consider(1, 1, 1, 100_000);
    r.consider(1.001, 1, 1, 50_000);
    r.consider(1.002, 1, 1, 62_000);
    expect(r.points.map((point) => point.t)).toEqual([100_000, 100_001, 112_001]);
    expect(r.points[1].gap).toBe(true);
  });

  it('preserves a restored future clock epoch and gaps the first corrected fix', async () => {
    const correctedNow = Date.now();
    const oldClockTail = correctedNow + 60_000;
    const store = {
      all: async () => [{ lat: 1, lon: 1, t: oldClockTail, sog: 1 }],
      append: async () => {},
      clear: async () => {},
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    await vi.waitFor(() => expect(r.restored).toBe(true));

    r.consider(1.001, 1, 1, correctedNow);
    r.consider(1.002, 1, 1, correctedNow + 12_000);

    expect(r.points.map((point) => point.t)).toEqual([
      oldClockTail,
      oldClockTail + 1,
      oldClockTail + 12_001,
    ]);
    expect(r.points[1].gap).toBe(true);
  });

  it('rebases a live startup fix after a late-restored future clock epoch', async () => {
    let resolveAll!: (points: TrackPoint[]) => void;
    const persisted: TrackPoint[] = [];
    const correctedNow = 1_000_000;
    const oldClockTail = correctedNow + 60_000;
    const store = {
      all: () => new Promise<TrackPoint[]>((resolve) => (resolveAll = resolve)),
      append: async (point: TrackPoint) => {
        persisted.push({ ...point });
      },
      clear: async () => {
        persisted.length = 0;
      },
    };
    const r = new TrackRecorder(createTrackSettings(createFakeStorage()), store);
    r.consider(1.001, 1, 1, correctedNow);
    resolveAll([{ lat: 1, lon: 1, t: oldClockTail, sog: 1 }]);
    await vi.waitFor(() => expect(r.restored).toBe(true));

    r.consider(1.002, 1, 1, correctedNow + 12_000);

    expect(r.points.map((point) => point.t)).toEqual([
      oldClockTail,
      oldClockTail + 1,
      oldClockTail + 12_001,
    ]);
    expect(r.points[1].gap).toBe(true);
    await vi.waitFor(() =>
      expect(persisted.map((point) => point.t)).toEqual([
        oldClockTail,
        oldClockTail + 1,
        oldClockTail + 12_001,
      ]),
    );
  });

  it('does not clear anything when the saved snapshot boundary is absent', () => {
    const r = recorder();
    r.consider(1, 1, 1, 1);
    r.consider(1.001, 1, 1, 12_000);
    r.clearThrough(6_000);
    expect(r.points.map((point) => point.t)).toEqual([1, 12_000]);
  });
});

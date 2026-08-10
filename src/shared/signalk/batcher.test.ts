import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FrameBatcher,
  MAX_BATCH_AIS_CONTEXTS,
  MAX_BATCH_AIS_PATHS_PER_CONTEXT,
  MAX_BATCH_SELF_PATHS,
} from './batcher';
import type { Value } from './types';

beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: (t: number) => void) => setTimeout(() => cb(0), 0) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('FrameBatcher', () => {
  it('coalesces many puts into one flush, last write wins', () => {
    const batcher = new FrameBatcher();
    const flushes: Map<string, Value>[] = [];
    batcher.onFlush = (self) => flushes.push(self);

    batcher.put('navigation.speedOverGround', 3.1);
    batcher.put('navigation.speedOverGround', 3.2);
    batcher.put('navigation.speedOverGround', 3.3);
    vi.runAllTimers();

    expect(flushes).toHaveLength(1);
    expect(flushes[0].get('navigation.speedOverGround')).toBe(3.3);
  });

  it('schedules a new flush after the previous one drains', () => {
    const batcher = new FrameBatcher();
    const flushes: Map<string, Value>[] = [];
    batcher.onFlush = (self) => flushes.push(self);

    batcher.put('a', 1);
    vi.runAllTimers();
    batcher.put('b', 2);
    vi.runAllTimers();

    expect(flushes).toHaveLength(2);
    expect(flushes[1]).toEqual(new Map([['b', 2]]));
  });

  it('does not flush when nothing was buffered', () => {
    const batcher = new FrameBatcher();
    const flushes: Map<string, Value>[] = [];
    batcher.onFlush = (self) => flushes.push(self);
    vi.runAllTimers();
    expect(flushes).toHaveLength(0);
  });

  it('reset() drops a pending flush and clears the buffers', () => {
    const batcher = new FrameBatcher();
    const flushes: Map<string, Value>[] = [];
    batcher.onFlush = (self) => flushes.push(self);

    batcher.put('navigation.speedOverGround', 3.1);
    batcher.reset();
    vi.runAllTimers();
    expect(flushes).toHaveLength(0);

    // Still reusable: a later put schedules and flushes afresh.
    batcher.put('navigation.headingTrue', 1);
    vi.runAllTimers();
    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toEqual(new Map([['navigation.headingTrue', 1]]));
  });

  it('prefers the timer scheduler outside a window even when rAF exists, so flushes continue while the tab is hidden', async () => {
    // The node test environment has no document, like a dedicated worker. Re-import the module so
    // the default scheduler is selected with requestAnimationFrame present but no window: it must
    // pick the timer (worker rAF is compositor-driven and stops in a hidden tab).
    expect(typeof document).toBe('undefined');
    vi.resetModules();
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const { FrameBatcher: WorkerBatcher } = await import('./batcher');
    const batcher = new WorkerBatcher();
    const flushes: Map<string, Value>[] = [];
    batcher.onFlush = (self) => flushes.push(self);
    batcher.put('navigation.position', { latitude: 0, longitude: 0 });
    vi.runAllTimers();
    expect(raf).not.toHaveBeenCalled();
    expect(flushes).toHaveLength(1);
  });

  it('accumulates per-vessel writes keyed by context, last write wins', () => {
    const batcher = new FrameBatcher();
    let captured: Map<string, Map<string, Value>> | undefined;
    batcher.onFlush = (_self, ais) => {
      captured = ais;
    };
    batcher.putVessel('vessels.a', 'navigation.speedOverGround', 1);
    batcher.putVessel('vessels.a', 'navigation.speedOverGround', 2);
    batcher.putVessel('vessels.b', 'navigation.headingTrue', 0.5);
    vi.runAllTimers();
    expect(captured?.get('vessels.a')?.get('navigation.speedOverGround')).toBe(2);
    expect(captured?.get('vessels.b')?.get('navigation.headingTrue')).toBe(0.5);
  });

  it('retains the receipt time of the winning value instead of the later flush time', () => {
    const batcher = new FrameBatcher();
    let selfEpochs: Map<string, number> | undefined;
    let aisEpochs: Map<string, Map<string, number>> | undefined;
    batcher.onFlush = (_self, _ais, _epoch, _sources, self, ais) => {
      selfEpochs = self;
      aisEpochs = ais;
    };
    batcher.put('navigation.position', { latitude: 1, longitude: 2 }, undefined, 1234);
    batcher.putVessel('vessels.a', 'navigation.position', { latitude: 3, longitude: 4 }, 2345);
    vi.runAllTimers();
    expect(selfEpochs?.get('navigation.position')).toBe(1234);
    expect(aisEpochs?.get('vessels.a')?.get('navigation.position')).toBe(2345);
  });

  it('reset() clears the AIS accumulator so a later putVessel only delivers the new frame', () => {
    const batcher = new FrameBatcher();
    const aisFrames: Map<string, Map<string, Value>>[] = [];
    batcher.onFlush = (_self, ais) => aisFrames.push(ais);

    batcher.putVessel('vessels.a', 'navigation.speedOverGround', 1);
    batcher.reset();
    batcher.putVessel('vessels.b', 'navigation.headingTrue', 0.7);
    vi.runAllTimers();

    expect(aisFrames).toHaveLength(1);
    // The first vessel was cleared by reset; only the second survives.
    expect(aisFrames[0].has('vessels.a')).toBe(false);
    expect(aisFrames[0].get('vessels.b')?.get('navigation.headingTrue')).toBe(0.7);
  });

  it('flushes a stale-only batch', () => {
    const batcher = new FrameBatcher();
    let stales: Map<string, unknown> | undefined;
    let selfSize = -1;
    batcher.onFlush = (self, _ais, _epoch, _sources, _epochs, _aisEpochs, selfStales) => {
      selfSize = self.size;
      stales = selfStales;
    };
    batcher.putStale('navigation.speedOverGround', { sourceRef: 'gps0' });
    vi.runAllTimers();
    expect(selfSize).toBe(0);
    expect(stales?.get('navigation.speedOverGround')).toEqual({ sourceRef: 'gps0' });
  });

  it('omits the stales map entirely on an ordinary flush', () => {
    const batcher = new FrameBatcher();
    let stales: Map<string, unknown> | undefined | 'unset' = 'unset';
    batcher.onFlush = (_self, _ais, _epoch, _sources, _epochs, _aisEpochs, selfStales) => {
      stales = selfStales;
    };
    batcher.put('navigation.speedOverGround', 3.1);
    vi.runAllTimers();
    expect(stales).toBeUndefined();
  });

  it('a later value supersedes a pending stale marker for the same path, even at the cap', () => {
    const batcher = new FrameBatcher();
    let stales: Map<string, unknown> | undefined;
    batcher.onFlush = (_self, _ais, _epoch, _sources, _epochs, _aisEpochs, selfStales) => {
      stales = selfStales;
    };
    // Fill self to the cap FIRST, then mark a capped-out path stale, then send its value: the
    // value is dropped by the cap but must still retire the marker, or wire order inverts.
    for (let index = 0; index < MAX_BATCH_SELF_PATHS; index += 1) {
      batcher.put(`self.${index}`, index);
    }
    batcher.putStale('navigation.overflow', {});
    batcher.put('navigation.overflow', 5);
    vi.runAllTimers();
    expect(stales).toBeUndefined();
  });

  it('a stale marker after a value keeps both, and never drops the pending value', () => {
    const batcher = new FrameBatcher();
    let self: Map<string, Value> | undefined;
    let stales: Map<string, unknown> | undefined;
    batcher.onFlush = (flushedSelf, _ais, _epoch, _sources, _epochs, _aisEpochs, selfStales) => {
      self = flushedSelf;
      stales = selfStales;
    };
    batcher.put('navigation.speedOverGround', 3.1);
    batcher.putStale('navigation.speedOverGround', {});
    vi.runAllTimers();
    expect(self?.get('navigation.speedOverGround')).toBe(3.1);
    expect(stales?.has('navigation.speedOverGround')).toBe(true);
  });

  it('reset() clears pending stale markers', () => {
    const batcher = new FrameBatcher();
    const flushes: unknown[] = [];
    batcher.onFlush = (...args) => flushes.push(args);
    batcher.putStale('navigation.speedOverGround', {});
    batcher.reset();
    vi.runAllTimers();
    expect(flushes).toHaveLength(0);
  });

  it('bounds self paths, AIS contexts, and AIS paths per context', () => {
    const batcher = new FrameBatcher();
    let selfSize = 0;
    let ais: Map<string, Map<string, Value>> | undefined;
    batcher.onFlush = (self, vessels) => {
      selfSize = self.size;
      ais = vessels;
    };
    for (let index = 0; index <= MAX_BATCH_SELF_PATHS; index += 1) {
      batcher.put(`self.${index}`, index);
    }
    for (let index = 0; index <= MAX_BATCH_AIS_CONTEXTS; index += 1) {
      batcher.putVessel(`vessels.${index}`, 'navigation.position', index);
    }
    for (let index = 0; index <= MAX_BATCH_AIS_PATHS_PER_CONTEXT; index += 1) {
      batcher.putVessel('vessels.0', `path.${index}`, index);
    }
    vi.runAllTimers();
    expect(selfSize).toBe(MAX_BATCH_SELF_PATHS);
    expect(ais?.size).toBe(MAX_BATCH_AIS_CONTEXTS);
    expect(ais?.get('vessels.0')?.size).toBe(MAX_BATCH_AIS_PATHS_PER_CONTEXT);
  });
});

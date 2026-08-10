import type { PathSource, PathStaleMarker, Value } from './types';

// A scheduler returns a cancel function, so a pending flush can be dropped on teardown rather than
// firing into a store the app is disposing.
type Schedule = (cb: (epoch: number) => void) => () => void;

export const MAX_BATCH_SELF_PATHS = 5_000;
export const MAX_BATCH_AIS_CONTEXTS = 2_000;
export const MAX_BATCH_AIS_PATHS_PER_CONTEXT = 64;

// The epoch stamped on each flush is a wall clock (Date.now), not the scheduler's
// high-res timestamp, which would use a different time origin than the main thread
// that prunes by staleness. Date.now is consistent across both threads.
//
// Outside a window (the worker, where this batcher actually runs) the scheduler is the
// timer, never requestAnimationFrame: modern dedicated workers do expose rAF, but it is
// compositor-driven and stops while the tab is hidden, which would freeze delta flushes
// in a backgrounded tab exactly when anchor, collision, and MOB monitoring matter. A
// window context keeps rAF for its alignment with rendering.
const defaultSchedule: Schedule =
  typeof document !== 'undefined' && typeof requestAnimationFrame === 'function'
    ? (cb) => {
        const id = requestAnimationFrame(() => cb(Date.now()));
        return () => cancelAnimationFrame(id);
      }
    : (cb) => {
        const id = setTimeout(() => cb(Date.now()), 16);
        return () => clearTimeout(id);
      };

export class FrameBatcher {
  onFlush?: (
    self: Map<string, Value>,
    ais: Map<string, Map<string, Value>>,
    epoch: number,
    selfSources?: Map<string, PathSource>,
    selfEpochs?: Map<string, number>,
    aisEpochs?: Map<string, Map<string, number>>,
    selfStales?: Map<string, PathStaleMarker>,
  ) => void;

  #self = new Map<string, Value>();
  #selfSources = new Map<string, PathSource>();
  #selfEpochs = new Map<string, number>();
  #selfStales = new Map<string, PathStaleMarker>();
  #ais = new Map<string, Map<string, Value>>();
  #aisEpochs = new Map<string, Map<string, number>>();
  #scheduled = false;
  #cancel: (() => void) | undefined;
  #schedule: Schedule;

  constructor(schedule: Schedule = defaultSchedule) {
    this.#schedule = schedule;
  }

  put(path: string, value: Value, source?: PathSource, receivedAt = Date.now()): void {
    // A real value supersedes a pending stale marker for the path, in wire order. Deleted before
    // the capacity check: a cap-dropped value must not leave an earlier marker alive to invert
    // that order.
    if (this.#selfStales.size > 0) this.#selfStales.delete(path);
    if (!this.#self.has(path) && this.#self.size >= MAX_BATCH_SELF_PATHS) return;
    this.#self.set(path, value);
    this.#selfEpochs.set(path, receivedAt);
    if (source) this.#selfSources.set(path, source);
    this.#mark();
  }

  // Record a server stale declaration for a self path. Never touches #self (a pending real value
  // stays batched; applyFrame applies values before markers, matching the wire order where the
  // marker arrived second) and never touches #selfSources (the marker's own sourceRef carries its
  // identity; writing the shared source channel would relabel another source's value sharing the
  // flush). A marker must never stamp an epoch or read as data flow.
  putStale(path: string, marker: PathStaleMarker): void {
    if (!this.#selfStales.has(path) && this.#selfStales.size >= MAX_BATCH_SELF_PATHS) return;
    this.#selfStales.set(path, marker);
    this.#mark();
  }

  putVessel(context: string, path: string, value: Value, receivedAt = Date.now()): void {
    let vessel = this.#ais.get(context);
    if (!vessel) {
      if (this.#ais.size >= MAX_BATCH_AIS_CONTEXTS) return;
      vessel = new Map();
      this.#ais.set(context, vessel);
    }
    if (!vessel.has(path) && vessel.size >= MAX_BATCH_AIS_PATHS_PER_CONTEXT) return;
    vessel.set(path, value);
    let epochs = this.#aisEpochs.get(context);
    if (!epochs) {
      epochs = new Map();
      this.#aisEpochs.set(context, epochs);
    }
    epochs.set(path, receivedAt);
    this.#mark();
  }

  // Drop any pending flush and clear the buffers, so a flush scheduled before teardown cannot fire
  // into a store the app is disposing. Leaves the batcher reusable: a later put schedules afresh.
  reset(): void {
    this.#cancel?.();
    this.#cancel = undefined;
    this.#scheduled = false;
    this.#self.clear();
    this.#selfSources.clear();
    this.#selfEpochs.clear();
    this.#selfStales.clear();
    this.#ais.clear();
    this.#aisEpochs.clear();
  }

  #mark(): void {
    if (this.#scheduled) return;
    this.#scheduled = true;
    this.#cancel = this.#schedule((epoch) => this.#flush(epoch));
  }

  #flush(epoch: number): void {
    this.#scheduled = false;
    this.#cancel = undefined;
    if (this.#self.size === 0 && this.#ais.size === 0 && this.#selfStales.size === 0) return;
    // Hand off the accumulated maps directly and start fresh. self mirrors how ais is already
    // passed: a Map crosses the Comlink boundary by structured clone, so neither needs converting
    // to a plain object on the hot path. Subsequent puts land in the new maps, not the handed-off
    // ones.
    const self = this.#self;
    const selfSources = this.#selfSources.size > 0 ? this.#selfSources : undefined;
    const selfEpochs = this.#selfEpochs;
    const selfStales = this.#selfStales.size > 0 ? this.#selfStales : undefined;
    const ais = this.#ais;
    const aisEpochs = this.#aisEpochs;
    this.#self = new Map();
    this.#selfEpochs = new Map();
    this.#ais = new Map();
    this.#aisEpochs = new Map();
    // The sparse channels are replaced only when actually handed off: an empty map was not passed
    // to onFlush, so reusing it saves an allocation per flush on the common frame.
    if (selfSources !== undefined) this.#selfSources = new Map();
    if (selfStales !== undefined) this.#selfStales = new Map();
    this.onFlush?.(self, ais, epoch, selfSources, selfEpochs, aisEpochs, selfStales);
  }
}

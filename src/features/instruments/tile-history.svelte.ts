export interface TileHistoryOptions {
  capacity?: number;
  minSpacingMs?: number;
}

export interface TileHistory {
  sample(id: string, value: number | undefined, nowMs: number): void;
  series(id: string): number[];
  prune(liveIds: Set<string>): void;
}

const DEFAULT_CAPACITY = 60;
const DEFAULT_MIN_SPACING_MS = 5000;

// Session-only per-tile ring buffers for the sparkline history. The caller drives sample() from its
// own clock, so this owns no timers and never persists.
export function createTileHistory(opts: TileHistoryOptions = {}): TileHistory {
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  const minSpacingMs = opts.minSpacingMs ?? DEFAULT_MIN_SPACING_MS;

  // Reactive buffers keyed by tile id, so a component reading series(id) re-renders on each append.
  // Deeply reactive on purpose: at one write per tile every minSpacingMs into a buffer of capacity
  // entries, the proxy overhead is nothing next to the ergonomics. If the sampling cadence ever
  // rises materially, this wants $state.raw plus a version counter instead.
  const buffers = $state<Record<string, number[]>>({});
  // Last accepted sample time per id; drives the min-spacing throttle and needs no reactivity.
  const lastMs = new Map<string, number>();

  function sample(id: string, value: number | undefined, nowMs: number): void {
    if (value === undefined) return;
    const last = lastMs.get(id);
    if (last !== undefined && nowMs - last < minSpacingMs) return;
    lastMs.set(id, nowMs);
    // Read back through the record so buf is the $state proxy (deep reactivity tracks the
    // mutations); the raw array captured before assignment would mutate invisibly.
    if (!buffers[id]) buffers[id] = [];
    const buf = buffers[id];
    buf.push(value);
    if (buf.length > capacity) buf.shift();
  }

  function series(id: string): number[] {
    return buffers[id] ?? [];
  }

  function prune(liveIds: Set<string>): void {
    for (const id of Object.keys(buffers)) {
      if (!liveIds.has(id)) {
        delete buffers[id];
        lastMs.delete(id);
      }
    }
  }

  return { sample, series, prune };
}

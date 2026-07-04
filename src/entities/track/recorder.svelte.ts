import { MINUTE_MS } from '$shared/lib';
import { haversineMeters } from '$shared/nav';
import type { PersistedValue, TrackSettings } from '$shared/settings';
import type { TrackStore } from '$shared/storage';
import type { TrackPoint, TrackStats } from './track-types';

// A fix this far in time after the previous one starts a new segment (GPS dropout, app
// closed, reconnect), so the line is not drawn straight across the gap.
const GAP_MS = 5 * MINUTE_MS;

export interface RecordDecision {
  append: boolean;
  gap: boolean;
}

// Whether a candidate fix should be recorded, given the last recorded point, the time of the
// last considered fix, and the settings. A fix is kept when both the interval and the
// min-distance since the last recorded point have passed (the min-distance doubles as a
// min-move threshold so the track does not pile up at anchor). A dropout is a silence in the
// fix stream itself (lastFixT), not time since the last recorded point: a stationary boat with
// continuous GPS keeps considering fixes, so it never gaps and the min-move check vetoes every
// append. lastFixT falls back to the recorded point's time when unknown (a restored track),
// where the silence since it is a real outage.
export function decideRecord(
  last: TrackPoint | undefined,
  lastFixT: number | undefined,
  lat: number,
  lon: number,
  now: number,
  settings: TrackSettings,
): RecordDecision {
  if (!last) return { append: true, gap: false };
  if (now - (lastFixT ?? last.t) > GAP_MS) return { append: true, gap: true };
  const dt = now - last.t;
  const moved = haversineMeters(last.lat, last.lon, lat, lon);
  if (dt >= settings.intervalSeconds * 1000 && moved >= settings.minMeters) {
    return { append: true, gap: false };
  }
  return { append: false, gap: false };
}

export function computeStats(points: readonly TrackPoint[]): TrackStats {
  if (points.length === 0) {
    return { distanceMeters: 0, durationSeconds: 0, avgSog: 0, maxSog: 0 };
  }
  let distanceMeters = 0;
  let maxSog = 0;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point.sog > maxSog) maxSog = point.sog;
    const prev = points[i - 1];
    if (prev && !point.gap) {
      distanceMeters += haversineMeters(prev.lat, prev.lon, point.lat, point.lon);
    }
  }
  const durationSeconds = (points[points.length - 1].t - points[0].t) / 1000;
  const avgSog = durationSeconds > 0 ? distanceMeters / durationSeconds : 0;
  return { distanceMeters, durationSeconds, avgSog, maxSog };
}

export class TrackRecorder {
  points = $state<TrackPoint[]>([]);
  paused = $state(false);

  // Distance and max SOG are accumulated per kept fix rather than derived from a full scan:
  // computeStats over the whole history is O(n) per read, which a long recording makes a real
  // per-render cost while the Tracks panel is open. The full scan runs only on restore.
  #distanceMeters = $state(0);
  #maxSog = $state(0);
  stats = $derived.by<TrackStats>(() => {
    const first = this.points[0];
    const last = this.points[this.points.length - 1];
    if (!first || !last) return { distanceMeters: 0, durationSeconds: 0, avgSog: 0, maxSog: 0 };
    const durationSeconds = (last.t - first.t) / 1000;
    const avgSog = durationSeconds > 0 ? this.#distanceMeters / durationSeconds : 0;
    return { distanceMeters: this.#distanceMeters, durationSeconds, avgSog, maxSog: this.#maxSog };
  });

  #settings: PersistedValue<TrackSettings>;
  #store: TrackStore<TrackPoint>;
  // Set when recording resumes or a paused fix arrives, so the next kept fix starts a break.
  #resumeGap = false;
  // When the last fix was considered (recorded or not), so a dropout is detected from the fix
  // stream rather than from the last recorded point.
  #lastFixT: number | undefined;

  constructor(settings: PersistedValue<TrackSettings>, store: TrackStore<TrackPoint>) {
    this.#settings = settings;
    this.#store = store;
    void this.#restore();
  }

  async #restore(): Promise<void> {
    const saved = await this.#store.all();
    if (saved.length === 0) return;
    // Coerce sog at the storage boundary: a point persisted by an older build can lack it, but
    // TrackPoint.sog is a number that every reader (the speed-colored line, the stats) trusts.
    const restored = saved.map((p) => ({ ...p, sog: p.sog ?? 0 }));
    // Prepend rather than assign: fixes recorded between construction and the store read must
    // not be clobbered by the restore.
    this.points = [...restored, ...this.points];
    // Re-seed the accumulators from the merged history in one pass, including the junction leg
    // between the restored tail and any fixes recorded before the store read resolved.
    const seeded = computeStats(this.points);
    this.#distanceMeters = seeded.distanceMeters;
    this.#maxSog = seeded.maxSog;
  }

  consider(lat: number, lon: number, sog: number, now: number = Date.now()): void {
    const lastFixT = this.#lastFixT;
    this.#lastFixT = now;
    if (this.paused) {
      this.#resumeGap = true;
      return;
    }
    const last = this.points[this.points.length - 1];
    const decision = decideRecord(last, lastFixT, lat, lon, now, this.#settings.value);
    if (!decision.append) return;
    const point: TrackPoint = { lat, lon, t: now, sog };
    // Flag a gap when this point follows a break (a pause-resume or a fix-rate dropout) so the
    // renderer does not draw a line across it. Left absent otherwise rather than set false.
    if (decision.gap || this.#resumeGap) point.gap = true;
    this.#resumeGap = false;
    if (sog > this.#maxSog) this.#maxSog = sog;
    // A gapped point starts a new segment, so no leg distance accrues across the break,
    // matching computeStats.
    if (last && !point.gap) {
      this.#distanceMeters += haversineMeters(last.lat, last.lon, lat, lon);
    }
    this.points.push(point);
    void this.#store.append(point);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.#resumeGap = true;
  }

  clear(): void {
    this.points = [];
    this.#distanceMeters = 0;
    this.#maxSog = 0;
    this.#resumeGap = false;
    void this.#store.clear();
  }
}

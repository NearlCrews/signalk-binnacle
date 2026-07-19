import { MINUTE_MS } from '$shared/lib';
import { haversineMeters } from '$shared/nav';
import type { PersistedValue, TrackSettings } from '$shared/settings';
import type { TrackStore } from '$shared/storage';
import type { TrackPoint, TrackStats } from './track-types';

// A fix this far in time after the previous one starts a new segment (GPS dropout, app
// closed, reconnect), so the line is not drawn straight across the gap.
const GAP_MS = 5 * MINUTE_MS;
const JUMP_MIN_METERS = 500;
const JUMP_MAX_METERS_PER_SECOND = 80;

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
  lastFix?: Pick<TrackPoint, 'lat' | 'lon' | 't'>,
): RecordDecision {
  if (!last) return { append: true, gap: false };
  if (now <= (lastFixT ?? last.t)) return { append: false, gap: false };
  if (now - (lastFixT ?? last.t) > GAP_MS) return { append: true, gap: true };
  if (lastFix) {
    const fixDtSeconds = (now - lastFix.t) / 1000;
    const fixDistance = haversineMeters(lastFix.lat, lastFix.lon, lat, lon);
    if (
      fixDtSeconds > 0 &&
      fixDistance >= JUMP_MIN_METERS &&
      fixDistance / fixDtSeconds > JUMP_MAX_METERS_PER_SECOND
    ) {
      return { append: true, gap: true };
    }
  }
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
  restored = $state(false);

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
  // The logical timestamp of the last considered fix and its raw clock reading. Keeping both lets
  // a wall-clock regression start a new segment without making the stored timeline go backward.
  #lastFixT: number | undefined;
  #lastObservedT: number | undefined;
  #lastFix: Pick<TrackPoint, 'lat' | 'lon' | 't'> | undefined;
  #lifecycle = 0;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(settings: PersistedValue<TrackSettings>, store: TrackStore<TrackPoint>) {
    this.#settings = settings;
    this.#store = store;
    void this.#restore();
  }

  async #restore(): Promise<void> {
    const lifecycle = this.#lifecycle;
    const restoreStartedAt = Date.now();
    let saved: TrackPoint[];
    try {
      saved = await this.#store.all();
    } finally {
      this.restored = true;
    }
    if (lifecycle !== this.#lifecycle || saved.length === 0) return;
    // Coerce sog at the storage boundary: a point persisted by an older build can lack it, but
    // TrackPoint.sog is a number that every reader (the speed-colored line, the stats) trusts.
    let lastRestoredT = Number.NEGATIVE_INFINITY;
    const restored = saved.flatMap((p) => {
      if (
        !p ||
        typeof p !== 'object' ||
        !Number.isFinite(p.lat) ||
        p.lat < -90 ||
        p.lat > 90 ||
        !Number.isFinite(p.lon) ||
        p.lon < -180 ||
        p.lon > 180 ||
        !Number.isFinite(p.t) ||
        p.t > restoreStartedAt ||
        p.t <= lastRestoredT
      ) {
        return [];
      }
      lastRestoredT = p.t;
      const sog = Number.isFinite(p.sog) && p.sog >= 0 ? p.sog : 0;
      return [{ lat: p.lat, lon: p.lon, t: p.t, sog, gap: p.gap === true ? true : undefined }];
    });
    // Fixes can land before the store read completes. Merge them chronologically, preferring the
    // live copy on an equal timestamp, so a late restore cannot create a regressed timeline or
    // duplicate a write that became visible to the read transaction.
    const liveByTime = new Map(this.points.map((point) => [point.t, point]));
    const merged = [...restored.filter((point) => !liveByTime.has(point.t)), ...this.points].sort(
      (a, b) => a.t - b.t,
    );
    // A live fix recorded while IndexedDB was opening initially looked like the first point and had
    // no gap. Once restored history is inserted before it, reclassify that junction using the same
    // outage and implausible-jump policy as a normal incoming fix so app downtime is never bridged.
    this.points = merged.map((point, index) => {
      const previous = merged[index - 1];
      if (!previous || point.gap || !liveByTime.has(point.t) || liveByTime.has(previous.t)) {
        return point;
      }
      const decision = decideRecord(
        previous,
        undefined,
        point.lat,
        point.lon,
        point.t,
        this.#settings.value,
        previous,
      );
      return decision.gap ? { ...point, gap: true } : point;
    });
    if (this.#lastFixT === undefined) {
      const last = this.points[this.points.length - 1];
      if (last) {
        this.#lastFixT = last.t;
        this.#lastFix = { lat: last.lat, lon: last.lon, t: last.t };
      }
    }
    // Re-seed the accumulators from the merged history in one pass, including the junction leg
    // between the restored tail and any fixes recorded before the store read resolved.
    const seeded = computeStats(this.points);
    this.#distanceMeters = seeded.distanceMeters;
    this.#maxSog = seeded.maxSog;
  }

  consider(lat: number, lon: number, sog: number, now: number = Date.now()): void {
    if (
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180 ||
      !Number.isFinite(sog) ||
      !Number.isFinite(now)
    ) {
      return;
    }
    sog = Math.max(0, sog);
    const lastFixT = this.#lastFixT;
    const lastObservedT = this.#lastObservedT;
    const lastFix = this.#lastFix;
    if (lastObservedT !== undefined && now === lastObservedT) return;
    const clockRegressed = lastObservedT !== undefined && now < lastObservedT;
    let logicalNow = now;
    if (lastObservedT !== undefined && lastFixT !== undefined) {
      const elapsed = now - lastObservedT;
      if (elapsed < 0) logicalNow = lastFixT + 1;
      else if (now <= lastFixT) logicalNow = lastFixT + elapsed;
    }
    this.#lastObservedT = now;
    this.#lastFixT = logicalNow;
    this.#lastFix = { lat, lon, t: logicalNow };
    if (this.paused) {
      this.#resumeGap = true;
      return;
    }
    const last = this.points[this.points.length - 1];
    const decision = clockRegressed
      ? { append: true, gap: true }
      : decideRecord(last, lastFixT, lat, lon, logicalNow, this.#settings.value, lastFix);
    if (!decision.append) return;
    const point: TrackPoint = { lat, lon, t: logicalNow, sog };
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
    this.#writeQueue = this.#writeQueue.then(() => this.#store.append(point));
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.#resumeGap = true;
  }

  clear(): void {
    this.#lifecycle += 1;
    this.points = [];
    this.#distanceMeters = 0;
    this.#maxSog = 0;
    this.#resumeGap = false;
    this.#lastFixT = undefined;
    this.#lastObservedT = undefined;
    this.#lastFix = undefined;
    this.#writeQueue = this.#writeQueue.then(() => this.#store.clear());
  }

  // Remove only the prefix accepted by a completed server save. Fixes captured while that request
  // was in flight remain the new active recording and are rewritten to the local persistence log.
  clearThrough(savedThroughT: number): void {
    // The caller passes the final point from its immutable save snapshot. Require that exact point
    // to remain present instead of interpreting an arbitrary timestamp as a destructive cutoff.
    const boundaryIndex = this.points.findLastIndex((point) => point.t === savedThroughT);
    if (boundaryIndex < 0) return;
    const remaining = this.points.slice(boundaryIndex + 1);
    if (remaining.length === 0) {
      this.clear();
      return;
    }
    this.#lifecycle += 1;
    this.points = remaining.map((point, index) =>
      index === 0 ? { ...point, gap: undefined } : point,
    );
    const seeded = computeStats(this.points);
    this.#distanceMeters = seeded.distanceMeters;
    this.#maxSog = seeded.maxSog;
    const snapshot = this.points.map((point) => ({ ...point }));
    this.#writeQueue = this.#writeQueue.then(async () => {
      await this.#store.clear();
      for (const point of snapshot) await this.#store.append(point);
    });
  }
}

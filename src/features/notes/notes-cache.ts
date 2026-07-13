import { type Bbox4, bboxContains } from '$shared/geo';
import { MINUTE_MS } from '$shared/lib';
import type { NotePoint } from './notes-client';

// A fetched note set stays usable for this long before a re-fetch. POIs (marinas, anchorages, and
// hazards) are effectively static within a session, so a few minutes keeps them fresh while cutting
// the request volume that made panning slow.
const TTL_MS = 5 * MINUTE_MS;
// Keep only the most recent fetches so a long session of panning cannot grow the cache without bound.
const MAX_ENTRIES = 12;
interface CacheEntry {
  bbox: Bbox4;
  notes: NotePoint[];
  expires: number;
}

// The persisted-store key for a fetch area. Joined raw, not quantized: a reload restores the same
// camera, so the padded bbox reproduces bit-identically; any other view simply misses and fetches.
export function bboxKey(bbox: Bbox4): string {
  return bbox.join(',');
}

// A small, bounded, time-limited cache of fetched note sets keyed by the padded area each fetch
// covered. A viewport that still sits inside a recent fetch reuses it, so panning back, panning a
// little, or zooming in never re-hits the network.
export class NotesCache {
  #entries: CacheEntry[] = [];

  // The notes from the freshest non-expired fetch whose area still contains the viewport, or
  // undefined when nothing covers it and a fetch is needed. With allowExpired (the caller knows
  // the app is offline, so a re-fetch cannot succeed), an expired containing entry still answers
  // rather than letting the POIs vanish at TTL expiry; a fresh entry is still preferred.
  get(viewport: Bbox4, nowMs: number, allowExpired = false): NotePoint[] | undefined {
    let expired: NotePoint[] | undefined;
    for (let i = this.#entries.length - 1; i >= 0; i--) {
      const entry = this.#entries[i];
      if (!bboxContains(entry.bbox, viewport)) continue;
      if (entry.expires > nowMs) return entry.notes;
      if (allowExpired && !expired) expired = entry.notes;
    }
    return expired;
  }

  // Record a fetch's area and its notes, dropping expired entries and keeping only the newest
  // MAX_ENTRIES so the cache stays bounded.
  put(bbox: Bbox4, notes: NotePoint[], nowMs: number): void {
    this.#entries.push({ bbox, notes, expires: nowMs + TTL_MS });
    this.#entries = this.#entries.filter((entry) => entry.expires > nowMs).slice(-MAX_ENTRIES);
  }

  clear(): void {
    this.#entries = [];
  }
}

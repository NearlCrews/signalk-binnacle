import type { RadarData } from '$entities/weather';
import { fetchJsonOrUndefined, hasControlCharacters, isRecord } from '$shared/lib';

const MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json';

const MAX_RADAR_FRAMES = 128;
const MAX_RADAR_HOST_LENGTH = 512;
const MAX_RADAR_PATH_LENGTH = 1_024;

function safeHost(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_RADAR_HOST_LENGTH) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return undefined;
    }
    return url.href.replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function safeFrames(value: unknown): Array<{ time: number; path: string }> | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_RADAR_FRAMES) return undefined;
  const frames: Array<{ time: number; path: string }> = [];
  for (const frame of value) {
    if (!isRecord(frame) || !Number.isSafeInteger(frame.time) || (frame.time as number) <= 0) {
      return undefined;
    }
    const time = (frame.time as number) * 1000;
    if (!Number.isSafeInteger(time)) return undefined;
    const path = frame.path;
    if (
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('?') ||
      path.includes('#') ||
      path.length > MAX_RADAR_PATH_LENGTH ||
      hasControlCharacters(path)
    ) {
      return undefined;
    }
    frames.push({ time, path });
  }
  return frames;
}

export interface RadarTimeline {
  latestObservedTime?: number;
  firstFutureTime?: number;
  latestFrameTime?: number;
  hasFutureFrames: boolean;
}

// Classify the timeline by valid time rather than RainViewer's bucket name. A provider "nowcast"
// entry at or behind the wall clock is still an observation from the user's point of view.
export function radarTimeline(
  frames: ReadonlyArray<{ time: number }>,
  nowMs: number,
): RadarTimeline {
  let latestObservedTime: number | undefined;
  let firstFutureTime: number | undefined;
  let latestFrameTime: number | undefined;
  for (const frame of frames) {
    latestFrameTime = Math.max(latestFrameTime ?? frame.time, frame.time);
    if (frame.time <= nowMs) {
      latestObservedTime = Math.max(latestObservedTime ?? frame.time, frame.time);
    } else {
      firstFutureTime = Math.min(firstFutureTime ?? frame.time, frame.time);
    }
  }
  return {
    latestObservedTime,
    firstFutureTime,
    latestFrameTime,
    hasFutureFrames: firstFutureTime !== undefined,
  };
}

// Fetch the RainViewer radar frame index (past plus nowcast). Best-effort: returns undefined on any
// failure so the radar layer degrades quietly. Times are converted to ms; frames are ascending.
export async function fetchRadar(
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<RadarData | undefined> {
  const body = await fetchJsonOrUndefined<unknown>(MAPS_URL, { credentials: 'omit' }, fetchFn);
  if (!isRecord(body) || !isRecord(body.radar)) return undefined;
  const host = safeHost(body.host);
  const past = safeFrames(body.radar.past);
  const nowcast = safeFrames(body.radar.nowcast);
  if (!host || !past || !nowcast || past.length + nowcast.length > MAX_RADAR_FRAMES) {
    return undefined;
  }
  const frames = [...past, ...nowcast].sort((a, b) => a.time - b.time);
  if (frames.length === 0) return undefined;
  return { host, frames };
}

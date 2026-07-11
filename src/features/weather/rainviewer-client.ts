import type { RadarData } from '$entities/weather';
import { fetchJsonOrUndefined } from '$shared/lib';

const MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json';

interface RainViewerMaps {
  host?: string;
  radar?: {
    past?: Array<{ time: number; path: string }>;
    nowcast?: Array<{ time: number; path: string }>;
  };
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
  const body = await fetchJsonOrUndefined<RainViewerMaps>(
    MAPS_URL,
    { credentials: 'omit' },
    fetchFn,
  );
  if (body === undefined) return undefined;
  if (!body.host || !body.radar) return undefined;
  const raw = [...(body.radar.past ?? []), ...(body.radar.nowcast ?? [])];
  const frames = raw
    .map((f) => ({ time: f.time * 1000, path: f.path }))
    .sort((a, b) => a.time - b.time);
  if (frames.length === 0) return undefined;
  return { host: body.host, frames };
}

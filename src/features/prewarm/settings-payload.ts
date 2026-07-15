/** Build the /api/position-warm/config payload from the position-warm settings controls. Values are
 * SI (meters, seconds); the panel converts from the display unit through UnitField before calling
 * this function. */

import { isFiniteNumber, isRecord } from '$shared/lib';

const MAX_DISTANCE_METERS = 1_000_000;
const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 86_400;
const MAX_ZOOM = 22;
const MAX_SOURCES = 256;
const MAX_SOURCE_ID_LENGTH = 256;

export interface PositionWarmSettings {
  enabled: boolean;
  radiusMeters: number;
  moveThresholdMeters: number;
  intervalSecs: number;
  baseZoom: number;
  sources: string[];
}

export function buildConfigPayload(settings: PositionWarmSettings): {
  positionWarm: PositionWarmSettings;
} {
  return { positionWarm: settings };
}

// Extract and validate the position-warm settings from the config response. Returns null when the
// response is absent, malformed, or missing required fields, so the panel keeps its defaults.
//
// GET /api/position-warm/config returns the positionWarm block directly, not a { positionWarm }
// wrapper (the wrapper exists only on POST so a save merges that one key without dropping the saved
// regions). Accept either shape so the panel restores its saved auto-cache state whichever the server
// sends: reading only the wrapper left the load silently returning null, so a saved setting looked
// unsaved on reopen.
export function extractPositionWarm(cfg: unknown): PositionWarmSettings | null {
  if (!isRecord(cfg)) return null;
  const pw = isRecord(cfg.positionWarm) ? cfg.positionWarm : cfg;
  if (
    typeof pw.enabled !== 'boolean' ||
    !isFiniteNumber(pw.radiusMeters) ||
    pw.radiusMeters <= 0 ||
    pw.radiusMeters > MAX_DISTANCE_METERS ||
    !isFiniteNumber(pw.moveThresholdMeters) ||
    pw.moveThresholdMeters <= 0 ||
    pw.moveThresholdMeters > MAX_DISTANCE_METERS ||
    !isFiniteNumber(pw.intervalSecs) ||
    !Number.isSafeInteger(pw.intervalSecs) ||
    pw.intervalSecs < MIN_INTERVAL_SECONDS ||
    pw.intervalSecs > MAX_INTERVAL_SECONDS ||
    !isFiniteNumber(pw.baseZoom) ||
    !Number.isSafeInteger(pw.baseZoom) ||
    pw.baseZoom < 0 ||
    pw.baseZoom > MAX_ZOOM ||
    !Array.isArray(pw.sources)
  )
    return null;
  const sources = [
    ...new Set(
      pw.sources.filter(
        (source): source is string =>
          typeof source === 'string' && source.length > 0 && source.length <= MAX_SOURCE_ID_LENGTH,
      ),
    ),
  ].slice(0, MAX_SOURCES);
  return {
    enabled: pw.enabled,
    radiusMeters: pw.radiusMeters,
    moveThresholdMeters: pw.moveThresholdMeters,
    intervalSecs: pw.intervalSecs,
    baseZoom: pw.baseZoom,
    sources,
  };
}

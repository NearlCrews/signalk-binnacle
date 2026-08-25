/** Build the /api/position-warm/config payload from the position-warm settings controls. Values are
 * SI (meters, seconds); the panel converts from the display unit through UnitField before calling
 * this function. */

import { clampInt, hasControlCharacters, isFiniteNumber, isRecord } from '$shared/lib';
import {
  CHART_LOCKER_MAX_DISTANCE_METERS,
  CHART_LOCKER_MAX_INTERVAL_SECONDS,
  CHART_LOCKER_MAX_SOURCE_ID_LENGTH,
  CHART_LOCKER_MAX_SOURCES,
  CHART_LOCKER_MAX_WARM_ZOOM,
  CHART_LOCKER_MIN_INTERVAL_SECONDS,
} from './contract.js';

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
  const sources = [
    ...new Set(
      settings.sources
        .slice(0, 4_096)
        .filter(
          (source) =>
            source.length > 0 &&
            source.length <= CHART_LOCKER_MAX_SOURCE_ID_LENGTH &&
            !hasControlCharacters(source),
        ),
    ),
  ].slice(0, CHART_LOCKER_MAX_SOURCES);
  return {
    positionWarm: {
      enabled: settings.enabled,
      radiusMeters: Math.min(CHART_LOCKER_MAX_DISTANCE_METERS, Math.max(1, settings.radiusMeters)),
      moveThresholdMeters: Math.min(
        CHART_LOCKER_MAX_DISTANCE_METERS,
        Math.max(0, settings.moveThresholdMeters),
      ),
      intervalSecs: clampInt(
        settings.intervalSecs,
        CHART_LOCKER_MIN_INTERVAL_SECONDS,
        CHART_LOCKER_MAX_INTERVAL_SECONDS,
      ),
      baseZoom: clampInt(settings.baseZoom, 0, CHART_LOCKER_MAX_WARM_ZOOM),
      sources,
    },
  };
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
    pw.radiusMeters > CHART_LOCKER_MAX_DISTANCE_METERS ||
    !isFiniteNumber(pw.moveThresholdMeters) ||
    pw.moveThresholdMeters < 0 ||
    pw.moveThresholdMeters > CHART_LOCKER_MAX_DISTANCE_METERS ||
    !isFiniteNumber(pw.intervalSecs) ||
    !Number.isSafeInteger(pw.intervalSecs) ||
    pw.intervalSecs < CHART_LOCKER_MIN_INTERVAL_SECONDS ||
    pw.intervalSecs > CHART_LOCKER_MAX_INTERVAL_SECONDS ||
    !isFiniteNumber(pw.baseZoom) ||
    !Number.isSafeInteger(pw.baseZoom) ||
    pw.baseZoom < 0 ||
    pw.baseZoom > CHART_LOCKER_MAX_WARM_ZOOM ||
    !Array.isArray(pw.sources) ||
    pw.sources.length > 4_096
  )
    return null;
  const sources = [
    ...new Set(
      pw.sources.filter(
        (source): source is string =>
          typeof source === 'string' &&
          source.length > 0 &&
          source.length <= CHART_LOCKER_MAX_SOURCE_ID_LENGTH &&
          !hasControlCharacters(source),
      ),
    ),
  ].slice(0, CHART_LOCKER_MAX_SOURCES);
  return {
    enabled: pw.enabled,
    radiusMeters: pw.radiusMeters,
    moveThresholdMeters: pw.moveThresholdMeters,
    intervalSecs: pw.intervalSecs,
    baseZoom: pw.baseZoom,
    sources,
  };
}

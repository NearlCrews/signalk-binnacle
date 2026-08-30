import { isRecord, readBoundedJson, withTimeout } from '$shared/lib';
import { cleanTruncatedText } from '$shared/signalk';
import {
  type EndpointOutcome,
  normalizeWeatherWarnings,
  parseWeatherWarning,
  type WeatherWarning,
} from './signalk-weather';

// Free point alerts from the US National Weather Service: the warnings fallback when no Signal K
// weather provider is configured, or when the provider's warnings endpoint is unsupported. US
// coverage only; a point outside it reads as unsupported, never as an all-clear.
const NWS_ALERTS_BASE = 'https://api.weather.gov/alerts/active';
const NWS_SOURCE = 'NWS';
const MAX_NWS_ALERTS = 20;
// An alert description can run thousands of characters of multi-line prose; the panel row wants a
// headline-sized version, clipped rather than rejected since the text informs, it is not a key.
const MAX_NWS_DETAILS_LENGTH = 512;
const MAX_NWS_EVENT_LENGTH = 256;
// api.weather.gov redirects coordinates finer than four decimals; quantizing here skips that
// round-trip.
const COORD_DECIMALS = 4;

// NWS severity grades, best first; anything unrecognized sorts after Minor so the count cap can
// never drop an Extreme alert in favor of a pile of advisories.
const SEVERITY_RANK: Record<string, number> = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };
const SEVERITY_RANK_UNKNOWN = 4;

type Fetch = typeof fetch;
const defaultFetch: Fetch = globalThis.fetch.bind(globalThis);

// NWS text carries newlines, which the shared cleaners refuse as control characters; collapse all
// whitespace runs to single spaces before cleaning and clipping.
function collapsedText(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string'
    ? cleanTruncatedText(value.replace(/\s+/g, ' '), maxLength)
    : undefined;
}

interface RankedWarning {
  warning: WeatherWarning;
  severity: number;
}

function rankedWarningFromFeature(feature: unknown): RankedWarning | undefined {
  if (!isRecord(feature) || !isRecord(feature.properties)) return undefined;
  const p = feature.properties;
  // Reusing the provider-warning parser keeps NWS alerts inside the exact same bounds and time
  // validation as provider warnings, so the persisted-cache validator round-trips them unchanged.
  const warning = parseWeatherWarning({
    startTime: p.onset ?? p.effective ?? p.sent,
    endTime: p.ends ?? p.expires,
    details:
      collapsedText(p.headline, MAX_NWS_DETAILS_LENGTH) ??
      collapsedText(p.description, MAX_NWS_DETAILS_LENGTH),
    source: NWS_SOURCE,
    type: collapsedText(p.event, MAX_NWS_EVENT_LENGTH),
  });
  if (!warning) return undefined;
  const severity =
    typeof p.severity === 'string'
      ? (SEVERITY_RANK[p.severity] ?? SEVERITY_RANK_UNKNOWN)
      : SEVERITY_RANK_UNKNOWN;
  return { warning, severity };
}

// Active NWS alerts at a point, in the loader's endpoint-outcome grammar: success with warnings,
// empty for a genuine in-coverage all-clear, unsupported for a point outside NWS coverage (so the
// panel keeps saying warnings are unavailable rather than implying none are active), and failure
// for transport trouble (which lets cached warnings replay as stale).
export async function fetchNwsAlertsResult(
  lat: number,
  lon: number,
  fetchFn: Fetch = defaultFetch,
): Promise<EndpointOutcome<WeatherWarning[]>> {
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    return { status: 'failure' };
  }
  const url = `${NWS_ALERTS_BASE}?point=${lat.toFixed(COORD_DECIMALS)},${lon.toFixed(COORD_DECIMALS)}`;
  try {
    // A browser cannot set the User-Agent header api.weather.gov requests as courtesy; the
    // explicit geo+json accept is the etiquette a webapp can offer. The Signal K token must never
    // ride along: this is a third-party origin.
    const response = await fetchFn(
      url,
      withTimeout({ headers: { accept: 'application/geo+json' } }),
    );
    // With validated, quantized coordinates a 400 or 404 means the point is outside NWS coverage.
    if (response.status === 400 || response.status === 404) return { status: 'unsupported' };
    if (!response.ok) return { status: 'failure' };
    const body = await readBoundedJson<unknown>(response);
    if (!isRecord(body) || !Array.isArray(body.features)) return { status: 'failure' };
    if (body.features.length === 0) return { status: 'empty' };
    const ranked: RankedWarning[] = [];
    for (const feature of body.features) {
      const entry = rankedWarningFromFeature(feature);
      if (entry) ranked.push(entry);
    }
    // Features present but none usable is shape drift, not an all-clear.
    if (ranked.length === 0) return { status: 'failure' };
    ranked.sort(
      (a, b) =>
        a.severity - b.severity ||
        Date.parse(a.warning.startTime) - Date.parse(b.warning.startTime),
    );
    const warnings = normalizeWeatherWarnings(
      ranked.slice(0, MAX_NWS_ALERTS).map((entry) => entry.warning),
    );
    return { status: 'success', value: warnings };
  } catch {
    return { status: 'failure' };
  }
}

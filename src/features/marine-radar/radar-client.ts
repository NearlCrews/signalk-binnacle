import {
  fetchJsonOrUndefined,
  hasControlCharacters,
  isFiniteNumber,
  isRecord,
  readBoundedJson,
  sameJsonValue,
  withTimeout,
} from '$shared/lib';
import { appendToken, authInit, sendJson } from '$shared/signalk';
import {
  isSafeRadarGeometry,
  MAX_RADAR_CONTROLS,
  MAX_RADAR_ID_LENGTH,
  MAX_RADAR_JSON_BYTES,
  MAX_RADAR_LEGEND_ENTRIES,
  MAX_RADAR_TEXT_LENGTH,
  MAX_RADAR_URL_LENGTH,
  MAX_RADARS,
} from './radar-limits';
import type {
  ControlDefinition,
  LegendEntry,
  RadarAvailability,
  RadarCapabilities,
  RadarControls,
  RadarInfo,
  RadarStatus,
  RadarStructuredValue,
} from './radar-types';

// The Signal K v2 radar API. The server serves a JSON ARRAY of RadarInfo objects here (each with its
// own `id`); a Radar API provider populates it, and a stock server with no provider returns `[]`.
// Note: the server's published OpenAPI doc models this as an id-keyed map, but the implementation and
// the @signalk/server-api RadarInfo type return an array, which is what is verified against here. Do
// not "correct" this to a map from the OpenAPI doc.
const RADARS_PATH = '/signalk/v2/api/vessels/self/radars';

const RADAR_STATUSES: ReadonlySet<string> = new Set(['off', 'standby', 'transmit', 'warming']);
const MAX_RADAR_RANGE_METERS = 1_000_000;
const MAX_RADAR_CONTROL_MAGNITUDE = 1_000_000;
const CONTROL_TYPES: ReadonlySet<string> = new Set([
  'boolean',
  'number',
  'enum',
  'string',
  'button',
  'sector',
  'zone',
  'rect',
  'compound',
]);
const MAGIC_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeUniqueIdentities<T>(values: T[], identity: (value: T) => string): T[] {
  const accepted = new Map<string, T>();
  const conflicted = new Set<string>();
  for (const value of values) {
    const id = identity(value);
    if (conflicted.has(id)) continue;
    const previous = accepted.get(id);
    if (previous === undefined) {
      accepted.set(id, value);
    } else if (!sameJsonValue(previous, value)) {
      accepted.delete(id);
      conflicted.add(id);
    }
  }
  return [...accepted.values()];
}

export function normalizeRadarIdentities(radars: RadarInfo[]): RadarInfo[] {
  return normalizeUniqueIdentities(radars, (radar) => radar.id);
}

export function normalizeControlDefinitions(controls: ControlDefinition[]): ControlDefinition[] {
  return normalizeUniqueIdentities(controls, (control) => control.id);
}

function safeStringId(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_RADAR_ID_LENGTH &&
    !hasControlCharacters(value)
    ? value
    : undefined;
}

function safeControlId(value: unknown): string | undefined {
  const id = safeStringId(value);
  return id && !MAGIC_OBJECT_KEYS.has(id) ? id : undefined;
}

function boundedText(value: unknown, maxLength = MAX_RADAR_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength && !hasControlCharacters(trimmed)
    ? trimmed
    : undefined;
}

function safeStreamUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_RADAR_URL_LENGTH ||
    hasControlCharacters(trimmed)
  ) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed, 'http://binnacle.invalid');
    if (
      !['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      return undefined;
    }
    return trimmed;
  } catch {
    return undefined;
  }
}

export function parseRadarControls(raw: unknown): RadarControls {
  if (!isRecord(raw)) return {};
  const entries = Object.entries(raw);
  if (entries.length > MAX_RADAR_CONTROLS) return {};
  const out = Object.create(null) as RadarControls;
  for (const [rawId, entry] of entries) {
    const id = safeControlId(rawId);
    if (!id) continue;
    if (isRecord(entry)) {
      const value = entry.value;
      const boundedNumber = (candidate: unknown): number | undefined =>
        isFiniteNumber(candidate) && Math.abs(candidate) <= MAX_RADAR_CONTROL_MAGNITUDE
          ? candidate
          : undefined;
      const boundedDistance = (candidate: unknown): number | undefined =>
        isFiniteNumber(candidate) && candidate >= 0 && candidate <= MAX_RADAR_CONTROL_MAGNITUDE
          ? candidate
          : undefined;
      out[id] = {
        value:
          (typeof value === 'number' &&
            Number.isFinite(value) &&
            Math.abs(value) <= MAX_RADAR_CONTROL_MAGNITUDE) ||
          (typeof value === 'string' &&
            value.length <= MAX_RADAR_TEXT_LENGTH &&
            !hasControlCharacters(value)) ||
          typeof value === 'boolean'
            ? value
            : undefined,
        auto: typeof entry.auto === 'boolean' ? entry.auto : undefined,
        autoValue: boundedNumber(entry.autoValue),
        enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
        endValue: boundedNumber(entry.endValue),
        startDistance: boundedDistance(entry.startDistance),
        endDistance: boundedDistance(entry.endDistance),
        x1: boundedNumber(entry.x1),
        y1: boundedNumber(entry.y1),
        x2: boundedNumber(entry.x2),
        y2: boundedNumber(entry.y2),
        width: boundedDistance(entry.width),
        allowed: typeof entry.allowed === 'boolean' ? entry.allowed : undefined,
      };
    }
  }
  return out;
}

// Validate each legend entry rather than casting the array wholesale: a malformed color would flow
// straight into the GL color table as NaN. Entries without a string color are dropped.
function parseLegend(raw: unknown): LegendEntry[] | undefined {
  if (!Array.isArray(raw) || raw.length > MAX_RADAR_LEGEND_ENTRIES) return undefined;
  const out: LegendEntry[] = [];
  for (const e of raw) {
    if (
      isRecord(e) &&
      typeof e.color === 'string' &&
      /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(e.color)
    ) {
      out.push({
        color: e.color,
        label: boundedText(e.label) ?? '',
        minValue: isFiniteNumber(e.minValue) ? e.minValue : undefined,
        maxValue: isFiniteNumber(e.maxValue) ? e.maxValue : undefined,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function toRadarInfo(raw: unknown): RadarInfo | undefined {
  if (!isRecord(raw)) return undefined;
  const id = safeStringId(raw.id);
  if (!id) return undefined;
  if (
    !isFiniteNumber(raw.spokesPerRevolution) ||
    !isFiniteNumber(raw.maxSpokeLen) ||
    !isSafeRadarGeometry(raw.spokesPerRevolution, raw.maxSpokeLen)
  ) {
    console.warn(
      `[marine-radar] radar ${id} reported unsafe geometry (spokesPerRevolution=${String(raw.spokesPerRevolution)}, maxSpokeLen=${String(raw.maxSpokeLen)})`,
    );
    return undefined;
  }
  // A blank or whitespace streamUrl is treated as absent so the built-in stream fallback engages rather
  // than `new WebSocket('')` throwing.
  const streamUrl = safeStreamUrl(raw.streamUrl);
  return {
    id,
    name: boundedText(raw.name) ?? id,
    brand: boundedText(raw.brand),
    status: RADAR_STATUSES.has(raw.status as string) ? (raw.status as RadarStatus) : 'off',
    spokesPerRevolution: raw.spokesPerRevolution,
    maxSpokeLen: raw.maxSpokeLen,
    range:
      typeof raw.range === 'number' &&
      Number.isFinite(raw.range) &&
      raw.range >= 0 &&
      raw.range <= MAX_RADAR_RANGE_METERS
        ? raw.range
        : 0,
    controls: parseRadarControls(raw.controls),
    legend: parseLegend(raw.legend),
    streamUrl,
  };
}

// A control's value range, only when minValue and maxValue are both real numbers: the slider binds
// them as numbers, so an undefined bound from a malformed capability must collapse the whole range to
// undefined (the slider then falls back to 0..100) rather than producing a NaN-bounded slider.
function parseRange(raw: Record<string, unknown>): ControlDefinition['range'] {
  if (
    !isFiniteNumber(raw.minValue) ||
    !isFiniteNumber(raw.maxValue) ||
    raw.minValue > raw.maxValue
  ) {
    return undefined;
  }
  return {
    min: raw.minValue,
    max: raw.maxValue,
    step: isFiniteNumber(raw.stepValue) && raw.stepValue > 0 ? raw.stepValue : undefined,
    unit: boundedText(raw.units, 64),
  };
}

// Enum choices from the spec's `descriptions` map (value to label). When the control declares
// `validValues`, restrict the choices to the values the radar will accept; otherwise offer every
// described state. Enum values are numeric on the wire.
function parseEnumValues(descriptions: unknown, validValues: unknown): ControlDefinition['values'] {
  if (!isRecord(descriptions)) return undefined;
  const wanted = Array.isArray(validValues)
    ? validValues.slice(0, MAX_RADAR_CONTROLS).filter((v): v is number => isFiniteNumber(v))
    : Object.keys(descriptions).map(Number).filter(Number.isFinite);
  const values = [...new Set(wanted)].slice(0, MAX_RADAR_CONTROLS).map((value) => {
    const label = descriptions[String(value)];
    return { value, label: boundedText(label) ?? String(value) };
  });
  return values.length > 0 ? values : undefined;
}

// The control types Binnacle renders with its slider, select, and toggle widgets. The radar API also
// defines string, button, sector, zone, rect, and compound controls; each needs a dedicated widget, so
// they are skipped rather than mis-rendered as a plain slider. The everyday power, gain, sea, rain,
// range, and mode controls are number, enum, or boolean, so the panel still shows what a helmsman
// reaches for. The set is shared by both capability dialects (mayara `dataType`, server-api `type`).
// The modes for a control that reports an automatic mode: it can be set to auto or driven manually.
const AUTO_MANUAL_MODES: Array<'auto' | 'manual'> = ['auto', 'manual'];

// Map one mayara-native capability schema, keyed by its control id, to a control definition. The id is
// the object key (used in the control write path), not the numeric `id` field. This is the dialect the
// Mayara serves: flat dataType/minValue/maxValue/stepValue/units, descriptions, and a
// flattened hasAuto/isReadOnly.
function toControlDefinition(id: string, raw: unknown): ControlDefinition | undefined {
  const idOnWire = safeControlId(id);
  if (!idOnWire || !isRecord(raw) || typeof raw.dataType !== 'string') return undefined;
  if (!CONTROL_TYPES.has(raw.dataType)) return undefined;
  const type = raw.dataType as ControlDefinition['type'];
  return {
    id: idOnWire,
    name: boundedText(raw.name) ?? idOnWire,
    description: boundedText(raw.description, 1_024),
    dialect: 'native',
    type,
    range: parseRange(raw),
    values: type === 'enum' ? parseEnumValues(raw.descriptions, raw.validValues) : undefined,
    // hasAuto declares an automatic mode; the panel offers an Auto toggle beside the manual value.
    modes: raw.hasAuto === true ? AUTO_MANUAL_MODES : undefined,
    readOnly: raw.isReadOnly === true,
    category: boundedText(raw.category),
    order: isFiniteNumber(raw.order) ? raw.order : undefined,
    hasEnabled: raw.hasEnabled === true,
    maxDistance:
      isFiniteNumber(raw.maxDistance) &&
      raw.maxDistance > 0 &&
      raw.maxDistance <= MAX_RADAR_CONTROL_MAGNITUDE
        ? raw.maxDistance
        : undefined,
  };
}

// The nested range of a ControlDefinitionV5 (the @signalk/server-api shape), only when min and max are
// both real numbers, mirroring parseRange's NaN guard.
function parseRangeV5(raw: Record<string, unknown>): ControlDefinition['range'] {
  const r = raw.range;
  if (!isRecord(r) || !isFiniteNumber(r.min) || !isFiniteNumber(r.max) || r.min > r.max)
    return undefined;
  return {
    min: r.min,
    max: r.max,
    step: isFiniteNumber(r.step) && r.step > 0 ? r.step : undefined,
    unit: boundedText(r.unit, 64),
  };
}

// The enum choices of a ControlDefinitionV5: an array of {value,label}. Preserve numeric and string
// values as distinct wire types so the select can send the provider's exact choice.
function parseValuesV5(values: unknown): ControlDefinition['values'] {
  if (!Array.isArray(values) || values.length > MAX_RADAR_CONTROLS) return undefined;
  const parsed: NonNullable<ControlDefinition['values']> = [];
  for (const v of values) {
    if (
      isRecord(v) &&
      ((typeof v.value === 'number' && Number.isFinite(v.value)) ||
        (typeof v.value === 'string' &&
          v.value.length <= MAX_RADAR_TEXT_LENGTH &&
          !hasControlCharacters(v.value)))
    ) {
      parsed.push({ value: v.value, label: boundedText(v.label) ?? String(v.value) });
    }
  }
  const out = normalizeUniqueIdentities(parsed, ({ value }) => `${typeof value}:${String(value)}`);
  return out.length > 0 ? out : undefined;
}

// Map one ControlDefinitionV5 (the @signalk/server-api CapabilityManifest.controls array element) to a
// control definition: id, name, type, nested range, values, modes, and readOnly. A conformant server
// serves this dialect; the object-keyed mayara dialect is handled above. Both feed the same widgets.
function toControlDefinitionV5(raw: unknown): ControlDefinition | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') return undefined;
  const id = safeControlId(raw.id);
  if (!id) return undefined;
  if (!CONTROL_TYPES.has(raw.type)) return undefined;
  const modes = Array.isArray(raw.modes)
    ? raw.modes.filter((m): m is 'auto' | 'manual' => m === 'auto' || m === 'manual')
    : undefined;
  // The RENDERABLE guard above leaves only number, enum, or boolean, all members of the type union.
  const type = raw.type as ControlDefinition['type'];
  return {
    id,
    name: boundedText(raw.name) ?? id,
    description: boundedText(raw.description, 1_024),
    dialect: 'v5',
    type,
    range: parseRangeV5(raw),
    values: type === 'enum' ? parseValuesV5(raw.values) : undefined,
    modes: modes && modes.length > 0 ? modes : undefined,
    readOnly: raw.readOnly === true,
    category: boundedText(raw.category),
    order: isFiniteNumber(raw.order) ? raw.order : undefined,
    hasEnabled: raw.hasEnabled === true,
  };
}

// Discovery preserves the difference between no provider, restricted access, transport failure, invalid
// metadata, and a usable provider so the menu can explain the actual missing capability.
export interface RadarDiscovery {
  radars: RadarInfo[];
  availability: RadarAvailability;
  detail?: string;
}

// Discover the radars the Signal K server exposes. Returns no radars for a stock server with no provider
// (a 404), an auth refusal, or any transport failure: the radar layer simply degrades to "no radar". A
// non-404 error status is logged so a reachable-but-broken provider is not silently read as absent.
export async function discoverRadars(
  origin: string,
  token: string | undefined,
): Promise<RadarDiscovery> {
  try {
    const response = await fetch(`${origin}${RADARS_PATH}`, withTimeout(authInit(token)));
    if (!response.ok) {
      if (response.status !== 404) {
        console.warn(`[marine-radar] radar discovery returned ${response.status}`);
      }
      return {
        radars: [],
        availability:
          response.status === 401 || response.status === 403
            ? 'auth-required'
            : response.status === 404
              ? 'absent'
              : 'unreachable',
        detail: `Radar discovery returned HTTP ${response.status}.`,
      };
    }
    const body = await readBoundedJson<unknown>(response, MAX_RADAR_JSON_BYTES);
    if (!Array.isArray(body) || body.length > MAX_RADARS)
      return { radars: [], availability: 'invalid', detail: 'Radar discovery was not an array.' };
    const radars = normalizeRadarIdentities(
      body.map(toRadarInfo).filter((r): r is RadarInfo => r !== undefined),
    );
    return {
      radars,
      availability: radars.length > 0 ? 'available' : body.length > 0 ? 'invalid' : 'absent',
    };
  } catch (error) {
    return {
      radars: [],
      availability: 'unreachable',
      detail: error instanceof Error ? error.message : 'Radar discovery failed.',
    };
  }
}

// The control definitions for a radar (ranges, types, enum values), used to render the controls UI.
// Two dialects exist in the wild: the @signalk/server-api CapabilityManifest serves `controls` as an
// ARRAY of ControlDefinitionV5, while Mayara serves an OBJECT keyed by control id
// with native dataType/minValue fields. Parse whichever arrived so the controls render either way.
export async function fetchCapabilities(
  origin: string,
  token: string | undefined,
  radarId: string,
): Promise<RadarCapabilities | undefined> {
  const url = `${origin}${RADARS_PATH}/${encodeURIComponent(radarId)}/capabilities`;
  const body = await fetchJsonOrUndefined<unknown>(
    url,
    authInit(token),
    undefined,
    MAX_RADAR_JSON_BYTES,
  );
  if (!isRecord(body)) return undefined;
  if (Array.isArray(body.controls)) {
    if (body.controls.length > MAX_RADAR_CONTROLS) return undefined;
    const controls = normalizeControlDefinitions(
      body.controls
        .map(toControlDefinitionV5)
        .filter((c): c is ControlDefinition => c !== undefined),
    );
    return { controls };
  }
  if (isRecord(body.controls)) {
    const entries = Object.entries(body.controls);
    if (entries.length > MAX_RADAR_CONTROLS) return undefined;
    const controls = entries
      .map(([id, raw]) => toControlDefinition(id, raw))
      .filter((c): c is ControlDefinition => c !== undefined);
    return { controls };
  }
  return undefined;
}

// Fallback control definitions built from the controls a radar reported at discovery, for a provider
// that does not serve /capabilities (fetchCapabilities then returns undefined). The real dataType and
// range are unknown, so each becomes a plain numeric slider (the slider uses its 0..100 default), with
// an Auto toggle when the reported control carried an auto flag. The panel then shows the controls the
// radar reports rather than nothing.
export function capabilitiesFromControls(radar: RadarInfo): ControlDefinition[] {
  const out: ControlDefinition[] = [];
  for (const [id, entry] of Object.entries(radar.controls)) {
    if (!entry) continue;
    out.push({
      id,
      name: id,
      dialect: 'fallback',
      type:
        typeof entry.value === 'string'
          ? 'string'
          : typeof entry.value === 'boolean'
            ? 'boolean'
            : 'number',
      modes: entry.auto !== undefined ? AUTO_MANUAL_MODES : undefined,
      readOnly: true,
    });
  }
  return out;
}

// Hydrate the current control state from the standard Radar API controls endpoint. Live changes arrive
// over the Signal K stream; this request supplies the initial snapshot and a low-frequency recovery path.
export async function fetchRadarControls(
  origin: string,
  token: string | undefined,
  radarId: string,
): Promise<RadarControls | undefined> {
  const url = `${origin}${RADARS_PATH}/${encodeURIComponent(radarId)}/controls`;
  const body = await fetchJsonOrUndefined<unknown>(
    url,
    authInit(token),
    undefined,
    MAX_RADAR_JSON_BYTES,
  );
  if (!isRecord(body)) return undefined;
  return parseRadarControls(isRecord(body.controls) ? body.controls : body);
}

function transportSecurity(protocol: string): 'secure' | 'insecure' | undefined {
  if (protocol === 'https:' || protocol === 'wss:') return 'secure';
  if (protocol === 'http:' || protocol === 'ws:') return 'insecure';
  return undefined;
}

function effectiveTransportPort(url: URL): string | undefined {
  if (url.port) return url.port;
  const security = transportSecurity(url.protocol);
  if (security === 'secure') return '443';
  if (security === 'insecure') return '80';
  return undefined;
}

// Whether a provider stream resolves to the same transport endpoint as Signal K. HTTP and WS are
// the same insecure endpoint family, as are HTTPS and WSS. Comparing hostname and effective port
// explicitly avoids both suffix-host token leaks and the false mismatch produced by URL.origin when
// a provider already reports its stream with a WebSocket scheme.
function isSameOrigin(streamUrl: string, origin: string): boolean {
  try {
    const stream = new URL(streamUrl, origin);
    const server = new URL(origin);
    const streamSecurity = transportSecurity(stream.protocol);
    return (
      streamSecurity !== undefined &&
      streamSecurity === transportSecurity(server.protocol) &&
      stream.hostname === server.hostname &&
      effectiveTransportPort(stream) === effectiveTransportPort(server)
    );
  } catch {
    return false;
  }
}

// The radar's protobuf spoke stream URL. A provider populates streamUrl in practice; the fallback is the
// built-in per-radar stream endpoint. http(s) is
// rewritten to ws(s) for the WebSocket connect. The token is appended only for a same-origin stream (the
// built-in endpoint, or a provider streamUrl on this origin); a cross-host provider URL is left untouched
// so the device token is never leaked to another host.
export function spokesUrl(origin: string, radar: RadarInfo, token?: string): string {
  const raw = radar.streamUrl
    ? new URL(radar.streamUrl, origin).toString()
    : `${origin}${RADARS_PATH}/${encodeURIComponent(radar.id)}/stream`;
  if (raw.length > MAX_RADAR_URL_LENGTH) throw new Error('Radar stream URL is too long.');
  const sameOrigin = isSameOrigin(raw, origin);
  const parsed = new URL(raw);
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('Radar stream URL contains unsupported credentials or a fragment.');
  }
  if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
  else if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error(`Unsupported radar stream protocol: ${parsed.protocol}`);
  }
  if (token && sameOrigin) {
    parsed.searchParams.delete('token');
    return appendToken(parsed.toString(), token);
  }
  return parsed.toString();
}

// One control write: a manual value, or an auto-mode toggle. The v2 control PUT reads `body.value`
// when present and otherwise the whole body, so a manual write sends `{ value }` (which also takes the
// control out of auto) and an auto write sends `{ auto }` with no value (sending both would let the
// server's value-first extraction drop the auto flag).
export type ControlWrite = Record<string, number | string | boolean>;

// Set a single control. PUT /radars/{id}/controls/{controlId} with the value or the auto flag. Returns
// the outcome so the caller can tell an auth refusal (401/403, a read-only token) from any other
// failure; logs a rejected write. The caller updates the displayed state optimistically.
export async function writeControl(
  origin: string,
  token: string | undefined,
  radarId: string,
  controlId: string,
  write: ControlWrite,
): Promise<{ ok: boolean; status: number }> {
  const url = `${origin}${RADARS_PATH}/${encodeURIComponent(radarId)}/controls/${encodeURIComponent(controlId)}`;
  const result = await sendJson(url, token, 'PUT', write);
  const status = result?.status ?? 0;
  if (!result?.ok) {
    console.warn(`[marine-radar] control ${controlId} write rejected: ${status || 'network'}`);
  }
  return { ok: result?.ok ?? false, status };
}

// The single-control route forwards body.value to the provider, but some providers then wrap that
// value again before calling their radar API. Use the standard bulk-control route for structured
// values so the server passes a control map to setControls and the provider preserves every geometry
// field. The outer value envelope matches the server route's accepted request shape.
export async function writeStructuredControl(
  origin: string,
  token: string | undefined,
  radarId: string,
  controlId: string,
  value: RadarStructuredValue,
): Promise<{ ok: boolean; status: number }> {
  const url = `${origin}${RADARS_PATH}/${encodeURIComponent(radarId)}`;
  const result = await sendJson(url, token, 'PUT', { value: { [controlId]: value } });
  const status = result?.status ?? 0;
  if (!result?.ok) {
    console.warn(
      `[marine-radar] structured control ${controlId} write rejected: ${status || 'network'}`,
    );
  }
  return { ok: result?.ok ?? false, status };
}

// The mayara power enum value for each operational status, for the generic-control fallback below.
const POWER_INDEX: Record<RadarStatus, number> = { off: 0, standby: 1, transmit: 2, warming: 3 };

// The statuses for which the dedicated /power endpoint is absent and we retry via the generic control:
// a 404/405 (no typed endpoint) or a 501 (provider implements no setPower).
const POWER_FALLBACK_STATUS: ReadonlySet<number> = new Set([404, 405, 501]);

function powerOutcome(
  status: RadarStatus,
  res: Response | undefined,
): { ok: boolean; status: number } {
  const code = res?.status ?? 0;
  if (!res?.ok) {
    console.warn(`[marine-radar] power ${status} write rejected: ${code || 'network'}`);
  }
  return { ok: res?.ok ?? false, status: code };
}

// Set the radar's operational state (transmit/standby). The dedicated PUT /radars/{id}/power takes the
// status STRING and validates it server-side. A provider that exposes power only through the generic
// control map is retried through PUT /controls/power with the numeric enum index, so keying the radar up
// works either way. The auth/outcome contract matches writeControl so the caller handles 401/403 the same.
export async function setPower(
  origin: string,
  token: string | undefined,
  radarId: string,
  status: RadarStatus,
): Promise<{ ok: boolean; status: number }> {
  const base = `${origin}${RADARS_PATH}/${encodeURIComponent(radarId)}`;
  const primary = await sendJson(`${base}/power`, token, 'PUT', { value: status });
  if (primary && POWER_FALLBACK_STATUS.has(primary.status)) {
    return powerOutcome(
      status,
      await sendJson(`${base}/controls/power`, token, 'PUT', { value: POWER_INDEX[status] }),
    );
  }
  return powerOutcome(status, primary);
}

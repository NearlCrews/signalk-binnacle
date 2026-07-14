import { fetchJsonOrUndefined, isRecord, withTimeout } from '$shared/lib';
import { appendToken, authInit, sendJson, str } from '$shared/signalk';
import type {
  ControlDefinition,
  LegendEntry,
  RadarAvailability,
  RadarCapabilities,
  RadarControls,
  RadarInfo,
  RadarStatus,
} from './radar-types';

// The Signal K v2 radar API. The server serves a JSON ARRAY of RadarInfo objects here (each with its
// own `id`); a Radar API provider populates it, and a stock server with no provider returns `[]`.
// Note: the server's published OpenAPI doc models this as an id-keyed map, but the implementation and
// the @signalk/server-api RadarInfo type return an array, which is what is verified against here. Do
// not "correct" this to a map from the OpenAPI doc.
const RADARS_PATH = '/signalk/v2/api/vessels/self/radars';

const RADAR_STATUSES: ReadonlySet<string> = new Set(['off', 'standby', 'transmit', 'warming']);
const MAX_SPOKES_PER_REVOLUTION = 16_384;
const MAX_SPOKE_LENGTH = 8_192;
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_RADAR_RANGE_METERS = 1_000_000;
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

function safeGeometry(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum;
}

export function parseRadarControls(raw: unknown): RadarControls {
  if (!isRecord(raw)) return {};
  const out: RadarControls = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (isRecord(entry)) {
      const value = entry.value;
      out[id] = {
        value:
          typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
            ? value
            : undefined,
        auto: typeof entry.auto === 'boolean' ? entry.auto : undefined,
        autoValue: typeof entry.autoValue === 'number' ? entry.autoValue : undefined,
        enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
        endValue: typeof entry.endValue === 'number' ? entry.endValue : undefined,
        startDistance: typeof entry.startDistance === 'number' ? entry.startDistance : undefined,
        endDistance: typeof entry.endDistance === 'number' ? entry.endDistance : undefined,
        x: typeof entry.x === 'number' ? entry.x : undefined,
        y: typeof entry.y === 'number' ? entry.y : undefined,
        width: typeof entry.width === 'number' ? entry.width : undefined,
        height: typeof entry.height === 'number' ? entry.height : undefined,
        allowed: typeof entry.allowed === 'boolean' ? entry.allowed : undefined,
      };
    }
  }
  return out;
}

// Validate each legend entry rather than casting the array wholesale: a malformed color would flow
// straight into the GL color table as NaN. Entries without a string color are dropped.
function parseLegend(raw: unknown): LegendEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LegendEntry[] = [];
  for (const e of raw) {
    if (
      isRecord(e) &&
      typeof e.color === 'string' &&
      /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(e.color)
    ) {
      out.push({
        color: e.color,
        label: typeof e.label === 'string' ? e.label : '',
        minValue: typeof e.minValue === 'number' ? e.minValue : undefined,
        maxValue: typeof e.maxValue === 'number' ? e.maxValue : undefined,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function toRadarInfo(raw: unknown): RadarInfo | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string') return undefined;
  const id = raw.id;
  if (
    !safeGeometry(raw.spokesPerRevolution, MAX_SPOKES_PER_REVOLUTION) ||
    !safeGeometry(raw.maxSpokeLen, MAX_SPOKE_LENGTH) ||
    raw.spokesPerRevolution * raw.maxSpokeLen > MAX_FRAME_BYTES
  ) {
    console.warn(
      `[marine-radar] radar ${id} reported unsafe geometry (spokesPerRevolution=${String(raw.spokesPerRevolution)}, maxSpokeLen=${String(raw.maxSpokeLen)})`,
    );
    return undefined;
  }
  // A blank or whitespace streamUrl is treated as absent so the built-in stream fallback engages rather
  // than `new WebSocket('')` throwing.
  const streamUrl = typeof raw.streamUrl === 'string' ? raw.streamUrl.trim() : '';
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : id,
    brand: typeof raw.brand === 'string' ? raw.brand : undefined,
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
    streamUrl: streamUrl.length > 0 ? streamUrl : undefined,
  };
}

// A control's value range, only when minValue and maxValue are both real numbers: the slider binds
// them as numbers, so an undefined bound from a malformed capability must collapse the whole range to
// undefined (the slider then falls back to 0..100) rather than producing a NaN-bounded slider.
function parseRange(raw: Record<string, unknown>): ControlDefinition['range'] {
  if (typeof raw.minValue !== 'number' || typeof raw.maxValue !== 'number') return undefined;
  return {
    min: raw.minValue,
    max: raw.maxValue,
    step: typeof raw.stepValue === 'number' ? raw.stepValue : undefined,
    unit: typeof raw.units === 'string' ? raw.units : undefined,
  };
}

// Enum choices from the spec's `descriptions` map (value to label). When the control declares
// `validValues`, restrict the choices to the values the radar will accept; otherwise offer every
// described state. Enum values are numeric on the wire.
function parseEnumValues(descriptions: unknown, validValues: unknown): ControlDefinition['values'] {
  if (!isRecord(descriptions)) return undefined;
  const wanted = Array.isArray(validValues)
    ? validValues.filter((v): v is number => typeof v === 'number')
    : Object.keys(descriptions).map(Number).filter(Number.isFinite);
  const values = wanted.map((value) => {
    const label = descriptions[String(value)];
    return { value, label: typeof label === 'string' ? label : String(value) };
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
  if (!isRecord(raw) || typeof raw.dataType !== 'string') return undefined;
  if (!CONTROL_TYPES.has(raw.dataType)) return undefined;
  const type = raw.dataType as ControlDefinition['type'];
  return {
    id,
    name: str(raw.name) ?? id,
    description: str(raw.description),
    type,
    range: parseRange(raw),
    values: type === 'enum' ? parseEnumValues(raw.descriptions, raw.validValues) : undefined,
    // hasAuto declares an automatic mode; the panel offers an Auto toggle beside the manual value.
    modes: raw.hasAuto === true ? AUTO_MANUAL_MODES : undefined,
    readOnly: raw.isReadOnly === true,
    category: str(raw.category),
    order: typeof raw.order === 'number' ? raw.order : undefined,
    hasEnabled: raw.hasEnabled === true,
    allowed: typeof raw.allowed === 'boolean' ? raw.allowed : undefined,
  };
}

// The nested range of a ControlDefinitionV5 (the @signalk/server-api shape), only when min and max are
// both real numbers, mirroring parseRange's NaN guard.
function parseRangeV5(raw: Record<string, unknown>): ControlDefinition['range'] {
  const r = raw.range;
  if (!isRecord(r) || typeof r.min !== 'number' || typeof r.max !== 'number') return undefined;
  return {
    min: r.min,
    max: r.max,
    step: typeof r.step === 'number' ? r.step : undefined,
    unit: typeof r.unit === 'string' ? r.unit : undefined,
  };
}

// The enum choices of a ControlDefinitionV5: an array of {value,label}. The internal model is numeric,
// so a string-valued choice (legal in the type but not used by radar enums) is dropped.
function parseValuesV5(values: unknown): ControlDefinition['values'] {
  if (!Array.isArray(values)) return undefined;
  const out: NonNullable<ControlDefinition['values']> = [];
  for (const v of values) {
    if (isRecord(v) && (typeof v.value === 'number' || typeof v.value === 'string')) {
      out.push({ value: v.value, label: typeof v.label === 'string' ? v.label : String(v.value) });
    }
  }
  return out.length > 0 ? out : undefined;
}

// Map one ControlDefinitionV5 (the @signalk/server-api CapabilityManifest.controls array element) to a
// control definition: id, name, type, nested range, values, modes, and readOnly. A conformant server
// serves this dialect; the object-keyed mayara dialect is handled above. Both feed the same widgets.
function toControlDefinitionV5(raw: unknown): ControlDefinition | undefined {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.type !== 'string')
    return undefined;
  if (!CONTROL_TYPES.has(raw.type)) return undefined;
  const modes = Array.isArray(raw.modes)
    ? raw.modes.filter((m): m is 'auto' | 'manual' => m === 'auto' || m === 'manual')
    : undefined;
  // The RENDERABLE guard above leaves only number, enum, or boolean, all members of the type union.
  const type = raw.type as ControlDefinition['type'];
  return {
    id: raw.id,
    name: str(raw.name) ?? raw.id,
    description: str(raw.description),
    type,
    range: parseRangeV5(raw),
    values: type === 'enum' ? parseValuesV5(raw.values) : undefined,
    modes: modes && modes.length > 0 ? modes : undefined,
    readOnly: raw.readOnly === true,
    category: str(raw.category),
    order: typeof raw.order === 'number' ? raw.order : undefined,
    hasEnabled: raw.hasEnabled === true,
    allowed: typeof raw.allowed === 'boolean' ? raw.allowed : undefined,
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
    const body = await response.json();
    if (!Array.isArray(body))
      return { radars: [], availability: 'invalid', detail: 'Radar discovery was not an array.' };
    const radars = body.map(toRadarInfo).filter((r): r is RadarInfo => r !== undefined);
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
  const body = await fetchJsonOrUndefined<unknown>(url, authInit(token));
  if (!isRecord(body)) return undefined;
  if (Array.isArray(body.controls)) {
    const controls = body.controls
      .map(toControlDefinitionV5)
      .filter((c): c is ControlDefinition => c !== undefined);
    return { controls };
  }
  if (isRecord(body.controls)) {
    const controls = Object.entries(body.controls)
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
  const body = await fetchJsonOrUndefined<unknown>(url, authInit(token));
  if (!isRecord(body)) return undefined;
  return parseRadarControls(isRecord(body.controls) ? body.controls : body);
}

// Whether a provider-supplied streamUrl is on the server origin, by parsed-origin comparison (not a
// string prefix, which would match a suffix-extension host like `boat.local.evil.com` and leak the
// token). A streamUrl that fails to parse is treated as cross-origin.
function isSameOrigin(streamUrl: string, origin: string): boolean {
  try {
    return new URL(streamUrl, origin).origin === new URL(origin).origin;
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
  const sameOrigin = isSameOrigin(raw, origin);
  const parsed = new URL(raw);
  if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
  else if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error(`Unsupported radar stream protocol: ${parsed.protocol}`);
  }
  const ws = parsed.toString();
  return token && sameOrigin ? appendToken(ws, token) : ws;
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

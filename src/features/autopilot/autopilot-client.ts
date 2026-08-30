import {
  hasControlCharacters,
  isFiniteNumber,
  isRecord,
  readBoundedJson,
  withTimeout,
} from '$shared/lib';
import {
  authInit,
  mutationResultFor,
  type ResourceMutationResult,
  sendJson,
} from '$shared/signalk';

// The Signal K v2 Autopilot API, verified against the installed server's
// dist/api/autopilot/index.js. Discovery returns an ID-KEYED RECORD
// ({ [deviceId]: { provider, isDefault } }), not an array, and it answers 200 with {} on a v2
// server with no provider registered; the route itself 404s only on a server without the API (a
// 1.x server). A read against a device with no provider fails through the API's error middleware
// as HTTP 500 carrying { state: 'FAILED', statusCode: 400 }, so discovery, not the per-device
// read, is the absence signal. Writes are gated by the server's autopilot PUT authorization:
// a read-only token gets 403 { state: 'FAILED', statusCode: 403, message: 'Unauthorised' }.
export const AUTOPILOTS_PATH = '/signalk/v2/api/vessels/self/autopilots';

// The reserved id every route accepts for "the default device"; the server resolves it to the
// first registered device when no default was set explicitly.
export const DEFAULT_DEVICE_ID = '_default';

const MAX_AUTOPILOT_JSON_BYTES = 64 * 1024;
const MAX_AUTOPILOT_DEVICES = 16;
const MAX_AUTOPILOT_ID_LENGTH = 128;
const MAX_AUTOPILOT_TEXT_LENGTH = 256;
const MAX_AUTOPILOT_OPTION_ENTRIES = 32;
// The server clamps a target write to [-PI, 2PI]; accept the same closed range on reads so a
// malformed provider number can never reach the chip or the panel as a bearing.
const MAX_TARGET_RADIANS = 2 * Math.PI;
const MAGIC_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type TackDirection = 'port' | 'starboard';

export interface AutopilotDevice {
  id: string;
  provider: string;
  isDefault: boolean;
}

export interface AutopilotStateOption {
  name: string;
  // Whether this provider state is actively steering; the provider declares the mapping.
  engaged: boolean;
}

export interface AutopilotActionOption {
  id: string;
  name: string;
  available: boolean;
}

export interface AutopilotOptions {
  states: AutopilotStateOption[];
  modes: string[];
  actions: AutopilotActionOption[];
}

export interface AutopilotInfo {
  options: AutopilotOptions;
  // Radians. Compass and route targets are a 0..2 pi bearing; wind targets are a signed relative
  // angle, port negative.
  target: number | null;
  mode: string | null;
  state: string | null;
  engaged: boolean;
}

// absent covers both a server without the v2 API (404) and a v2 server whose discovery record is
// empty (no provider plugin registered); the two read the same to the helm and the panel's copy
// distinguishes them from the features roster. unreachable is a transport failure or a malformed
// answer: prior knowledge is kept rather than erased.
export type AutopilotAvailability = 'absent' | 'auth-required' | 'unreachable' | 'available';

export interface AutopilotDiscovery {
  devices: AutopilotDevice[];
  availability: AutopilotAvailability;
}

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_AUTOPILOT_ID_LENGTH &&
    !hasControlCharacters(value) &&
    !MAGIC_OBJECT_KEYS.has(value)
    ? value
    : undefined;
}

function boundedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 &&
    trimmed.length <= MAX_AUTOPILOT_TEXT_LENGTH &&
    !hasControlCharacters(trimmed)
    ? trimmed
    : undefined;
}

export async function discoverAutopilots(
  origin: string,
  token: string | undefined,
): Promise<AutopilotDiscovery> {
  try {
    const response = await fetch(`${origin}${AUTOPILOTS_PATH}`, withTimeout(authInit(token)));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { devices: [], availability: 'auth-required' };
      }
      // A 404 is the ordinary no-API answer from a v1 server; anything else is a reachable but
      // broken endpoint, which must not silently read as absent.
      if (response.status === 404) return { devices: [], availability: 'absent' };
      console.warn(`[autopilot] discovery returned ${response.status}`);
      return { devices: [], availability: 'unreachable' };
    }
    const body = await readBoundedJson<unknown>(response, MAX_AUTOPILOT_JSON_BYTES);
    if (!isRecord(body)) {
      console.warn('[autopilot] discovery was not a keyed record');
      return { devices: [], availability: 'unreachable' };
    }
    const entries = Object.entries(body);
    if (entries.length > MAX_AUTOPILOT_DEVICES) {
      console.warn(`[autopilot] discovery returned more than ${MAX_AUTOPILOT_DEVICES} devices`);
      return { devices: [], availability: 'unreachable' };
    }
    const devices: AutopilotDevice[] = [];
    for (const [rawId, raw] of entries) {
      const id = safeId(rawId);
      if (!id || !isRecord(raw)) continue;
      devices.push({
        id,
        provider: boundedText(raw.provider) ?? '',
        isDefault: raw.isDefault === true,
      });
    }
    return { devices, availability: devices.length > 0 ? 'available' : 'absent' };
  } catch {
    return { devices: [], availability: 'unreachable' };
  }
}

function parseStateOptions(raw: unknown): AutopilotStateOption[] {
  if (!Array.isArray(raw) || raw.length > MAX_AUTOPILOT_OPTION_ENTRIES) return [];
  const out: AutopilotStateOption[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const name = boundedText(entry.name);
    if (name) out.push({ name, engaged: entry.engaged === true });
  }
  return out;
}

function parseModes(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > MAX_AUTOPILOT_OPTION_ENTRIES) return [];
  return raw.map((mode) => boundedText(mode)).filter((mode): mode is string => mode !== undefined);
}

function parseActions(raw: unknown): AutopilotActionOption[] {
  if (!Array.isArray(raw) || raw.length > MAX_AUTOPILOT_OPTION_ENTRIES) return [];
  const out: AutopilotActionOption[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = safeId(entry.id);
    if (id)
      out.push({ id, name: boundedText(entry.name) ?? id, available: entry.available === true });
  }
  return out;
}

export function cleanTargetRadians(value: unknown): number | null {
  return isFiniteNumber(value) && Math.abs(value) <= MAX_TARGET_RADIANS ? value : null;
}

// The current data and options for one device: GET /autopilots/{id}. Undefined on any failure,
// including the no-provider error envelope; the caller keeps its prior snapshot.
export async function fetchAutopilotInfo(
  origin: string,
  token: string | undefined,
  deviceId: string,
): Promise<AutopilotInfo | undefined> {
  try {
    const response = await fetch(
      `${origin}${AUTOPILOTS_PATH}/${encodeURIComponent(deviceId)}`,
      withTimeout(authInit(token)),
    );
    if (!response.ok) return undefined;
    const body = await readBoundedJson<unknown>(response, MAX_AUTOPILOT_JSON_BYTES);
    if (!isRecord(body)) return undefined;
    const options = isRecord(body.options) ? body.options : undefined;
    return {
      options: {
        states: parseStateOptions(options?.states),
        modes: parseModes(options?.modes),
        actions: parseActions(options?.actions),
      },
      target: cleanTargetRadians(body.target),
      mode: boundedText(body.mode) ?? null,
      state: boundedText(body.state) ?? null,
      engaged: body.engaged === true,
    };
  } catch {
    return undefined;
  }
}

function deviceUrl(origin: string, deviceId: string): string {
  return `${origin}${AUTOPILOTS_PATH}/${encodeURIComponent(deviceId)}`;
}

// The command writes below all route through sendJson so the app-wide write-outcome listener sees
// a 401/403 refusal (how a read-only token reveals itself) and return the mutation outcome so the
// controller can separate a refusal from a transport failure. None of them throws.

export async function engageAutopilot(
  origin: string,
  token: string | undefined,
  deviceId: string,
): Promise<ResourceMutationResult> {
  return mutationResultFor(await sendJson(`${deviceUrl(origin, deviceId)}/engage`, token, 'POST'));
}

export async function disengageAutopilot(
  origin: string,
  token: string | undefined,
  deviceId: string,
): Promise<ResourceMutationResult> {
  return mutationResultFor(
    await sendJson(`${deviceUrl(origin, deviceId)}/disengage`, token, 'POST'),
  );
}

export async function setAutopilotMode(
  origin: string,
  token: string | undefined,
  deviceId: string,
  mode: string,
): Promise<ResourceMutationResult> {
  return mutationResultFor(
    await sendJson(`${deviceUrl(origin, deviceId)}/mode`, token, 'PUT', { value: mode }),
  );
}

// Relative target change in radians (port negative). The route reads radians unless a 'deg' units
// field is sent; Binnacle stays SI on the wire.
export async function adjustAutopilotTarget(
  origin: string,
  token: string | undefined,
  deviceId: string,
  deltaRadians: number,
): Promise<ResourceMutationResult> {
  return mutationResultFor(
    await sendJson(`${deviceUrl(origin, deviceId)}/target/adjust`, token, 'PUT', {
      value: deltaRadians,
    }),
  );
}

export async function tackAutopilot(
  origin: string,
  token: string | undefined,
  deviceId: string,
  direction: TackDirection,
): Promise<ResourceMutationResult> {
  return mutationResultFor(
    await sendJson(`${deviceUrl(origin, deviceId)}/tack/${direction}`, token, 'POST'),
  );
}

export async function gybeAutopilot(
  origin: string,
  token: string | undefined,
  deviceId: string,
  direction: TackDirection,
): Promise<ResourceMutationResult> {
  return mutationResultFor(
    await sendJson(`${deviceUrl(origin, deviceId)}/gybe/${direction}`, token, 'POST'),
  );
}

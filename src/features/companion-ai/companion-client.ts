import {
  cleanBoundedText,
  isRecord,
  isUnsafeProviderKey,
  readBoundedJson,
  withTimeout,
} from '$shared/lib';
import { authInit, sendJson } from '$shared/signalk';

// Client for the signalk-openrouter-companion plugin's advisory reports. The plugin publishes each
// analyzer's latest report as a self notification at notifications.openrouter-companion.
// {analyzerId}.report with state 'nominal' (deliberately quiet, so strict clients pop nothing) and
// a 'warn' state for a "report unavailable" entry. Binnacle's notifications mirror drops nominal
// states, so this client hydrates the branch over v1 REST instead. Fire-now is the plugin's Signal K
// PUT handler at plugins.openrouter-companion.{analyzerId}.run. The plugin's own REST routes under
// /plugins/signalk-openrouter-companion are administrator-gated and are never used here.

export const MAX_COMPANION_ANALYZERS = 64;
export const MAX_COMPANION_MESSAGE_LENGTH = 8192;
const MAX_STATE_LENGTH = 32;
const MAX_ACK_MESSAGE_LENGTH = 512;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_ACK_RESPONSE_BYTES = 65_536;

export interface CompanionReport {
  analyzerId: string;
  // The report text as published. Today the plugin headline-clamps this to one line; the parser
  // preserves line breaks so a fuller future report renders as prose without a client change.
  message: string;
  // 'nominal' for a standing report, 'warn' for a report-unavailable entry.
  state: string;
  timestampMs: number | undefined;
}

// 'absent' is a real 404: the plugin is not installed, or has not published since the server
// started (v1 notifications do not persist across a restart). A transport or server failure is
// 'unavailable' so retained reports are not mistaken for a plugin that vanished.
export type CompanionReportsResult =
  | { state: 'ok'; reports: CompanionReport[] }
  | { state: 'absent' }
  | { state: 'unavailable' };

export interface RunAnalyzerAck {
  kind: 'started' | 'completed' | 'refused' | 'access-denied' | 'unavailable' | 'unreachable';
  // The server's own ack sentence (budget exhausted, a run already in flight, nothing to report),
  // passed through so the honest reason reaches the panel.
  message?: string;
}

const reportsUrl = (origin: string): string =>
  `${origin}/signalk/v1/api/vessels/self/notifications/openrouter-companion`;

const runUrl = (origin: string, analyzerId: string): string =>
  `${origin}/signalk/v1/api/vessels/self/plugins/openrouter-companion/${encodeURIComponent(analyzerId)}/run`;

// Report prose can span lines, and the shared single-line cleaners reject any control character.
// This keeps newlines while refusing the rest, and clips rather than drops an oversized report:
// a long advisory cut short still reads, while a dropped one looks like the analyzer never ran.
function cleanReportProse(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength * 4) return undefined;
  const text = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  if (!text) return undefined;
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code < 32 || code === 127) && code !== 10) return undefined;
  }
  return text.slice(0, maxLength);
}

function parseTimestampMs(value: unknown): number | undefined {
  const text = cleanBoundedText(value, 64);
  if (!text) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : undefined;
}

function parseReport(analyzerId: string, node: unknown): CompanionReport | undefined {
  if (!isRecord(node)) return undefined;
  const leaf = node.report;
  if (!isRecord(leaf)) return undefined;
  const value = leaf.value;
  if (!isRecord(value)) return undefined;
  const message = cleanReportProse(value.message, MAX_COMPANION_MESSAGE_LENGTH);
  const state = cleanBoundedText(value.state, MAX_STATE_LENGTH);
  if (!message || !state) return undefined;
  // The Signal K model carries the timestamp beside the value; older shapes put it inside.
  return {
    analyzerId,
    message,
    state,
    timestampMs: parseTimestampMs(leaf.timestamp) ?? parseTimestampMs(value.timestamp),
  };
}

export async function fetchCompanionReports(
  origin: string,
  token: string | undefined,
): Promise<CompanionReportsResult> {
  try {
    const response = await fetch(reportsUrl(origin), withTimeout(authInit(token)));
    if (response.status === 404) return { state: 'absent' };
    if (!response.ok) return { state: 'unavailable' };
    const body = await readBoundedJson<unknown>(response, MAX_RESPONSE_BYTES);
    if (!isRecord(body)) return { state: 'ok', reports: [] };
    const reports: CompanionReport[] = [];
    for (const [analyzerId, node] of Object.entries(body)) {
      if (reports.length >= MAX_COMPANION_ANALYZERS) break;
      if (isUnsafeProviderKey(analyzerId)) continue;
      const report = parseReport(analyzerId, node);
      if (report) reports.push(report);
    }
    return { state: 'ok', reports };
  } catch {
    return { state: 'unavailable' };
  }
}

// Fire one analyzer now over the standard v1 PUT. Routed through sendJson so a 401 or 403 flips
// the app-wide write-blocked state like every other Signal K write. Never throws.
export async function runAnalyzer(
  origin: string,
  token: string | undefined,
  analyzerId: string,
): Promise<RunAnalyzerAck> {
  if (isUnsafeProviderKey(analyzerId)) return { kind: 'refused' };
  const response = await sendJson(runUrl(origin, analyzerId), token, 'PUT', { value: {} });
  if (!response) return { kind: 'unreachable' };
  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(response, MAX_ACK_RESPONSE_BYTES);
  } catch {
    body = undefined;
  }
  const message = isRecord(body)
    ? cleanBoundedText(body.message, MAX_ACK_MESSAGE_LENGTH)
    : undefined;
  if (response.status === 401 || response.status === 403) return { kind: 'access-denied', message };
  if (response.status === 404 || response.status === 405) return { kind: 'unavailable', message };
  if (!response.ok) return { kind: 'refused', message };
  const state = isRecord(body) ? body.state : undefined;
  return state === 'PENDING' ? { kind: 'started', message } : { kind: 'completed', message };
}

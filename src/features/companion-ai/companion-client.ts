import {
  cleanBoundedText,
  isRecord,
  isUnsafeProviderKey,
  readBoundedJson,
  withTimeout,
} from '$shared/lib';
import { authInit, isSameOriginPath, sendJson } from '$shared/signalk';

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
export const COMPANION_RUN_TIMEOUT_MS = 180_000;
const RUN_POLL_INTERVAL_MS = 1000;

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
  kind:
    | 'started'
    | 'completed'
    | 'refused'
    | 'access-denied'
    | 'unavailable'
    | 'unreachable'
    | 'unconfirmed';
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
  signal?: AbortSignal,
): Promise<RunAnalyzerAck> {
  if (isUnsafeProviderKey(analyzerId)) return { kind: 'refused' };
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) return { kind: 'unconfirmed' };
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, COMPANION_RUN_TIMEOUT_MS);
  try {
    let response = await sendJson(
      runUrl(origin, analyzerId),
      token,
      'PUT',
      { value: {} },
      controller.signal,
    );
    if (!response) return { kind: 'unreachable' };
    let statusPath: string | undefined;
    while (!controller.signal.aborted) {
      const body: unknown = await readBoundedJson<unknown>(response, MAX_ACK_RESPONSE_BYTES).catch(
        () => undefined,
      );
      const message = isRecord(body)
        ? cleanBoundedText(body.message, MAX_ACK_MESSAGE_LENGTH)
        : undefined;
      const status =
        isRecord(body) && Number.isInteger(body.statusCode) && typeof body.statusCode === 'number'
          ? body.statusCode
          : response.status;
      if (status === 401 || status === 403) return { kind: 'access-denied', message };
      if (status === 404 || status === 405) return { kind: 'unavailable', message };
      if (!response.ok || status >= 400 || (isRecord(body) && body.state === 'FAILED'))
        return { kind: 'refused', message };
      if (isRecord(body) && body.state === 'COMPLETED') return { kind: 'completed', message };
      if (!isRecord(body) || body.state !== 'PENDING') return { kind: 'unconfirmed', message };
      if (!statusPath) {
        const href = cleanBoundedText(body.href, 1024);
        // Only the public request-status route may receive the device bearer token. Do not
        // follow redirects or arbitrary same-origin plugin paths supplied by an untrusted ack.
        if (!href || !isSameOriginPath(href) || !/^\/signalk\/v1\/requests\/[^/?#]+$/.test(href)) {
          return { kind: 'unconfirmed' };
        }
        statusPath = href;
      }
      await waitForRunPoll(controller.signal);
      response = await fetch(
        `${origin}${statusPath}`,
        withTimeout(
          authInit(token, {
            signal: controller.signal,
            cache: 'no-store',
            redirect: 'error',
          }),
        ),
      );
    }
    return { kind: 'unconfirmed' };
  } catch {
    return { kind: 'unconfirmed' };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

function waitForRunPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, RUN_POLL_INTERVAL_MS);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

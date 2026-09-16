import { capitalize, formatDayClock, formatMonthDay, MINUTE_MS } from '$shared/lib';
import type { CompanionReport } from './companion-client';

// Mirrors ANALYZER_TITLES in the companion plugin (analyzers/ids.ts). A stale mirror is cosmetic:
// an analyzer this map does not know still renders through the humanized-id fallback.
const KNOWN_ANALYZER_TITLES = new Map<string, string>([
  ['maintenance', 'Maintenance Advisor'],
  ['health', 'Battery Health Advisor'],
  ['aging', 'Battery Aging Tracker'],
  ['drift', 'Engine Performance Drift'],
  ['alerts', 'Battery Alerts'],
  ['liveness', 'Sensor Liveness Monitor'],
  ['forecast', 'Weather Outlook Advisor'],
]);

export function analyzerTitle(analyzerId: string): string {
  return KNOWN_ANALYZER_TITLES.get(analyzerId) ?? capitalize(analyzerId.replaceAll(/[-_]+/g, ' '));
}

const MAX_HEADLINE_LENGTH = 160;

export function companionReportTime(timestampMs: number | undefined, nowMs: number): string {
  if (timestampMs === undefined || !Number.isFinite(timestampMs)) return 'Report time unknown';
  if (timestampMs > nowMs) return 'Report time is in the future; age unknown';
  const minutes = Math.floor((nowMs - timestampMs) / MINUTE_MS);
  const age =
    minutes < 1
      ? 'less than 1 min old'
      : minutes < 60
        ? `${minutes} min old`
        : minutes < 1_440
          ? `${Math.floor(minutes / 60)} h old`
          : `${Math.floor(minutes / 1_440)} days old`;
  return `${age}; ${formatMonthDay(timestampMs)} ${formatDayClock(timestampMs, { zone: true })}`;
}

// The one-line watch-handoff fact: a direct quote of the newest standing report, never a redraft.
// Warn entries are skipped because "report unavailable" is not standing advice worth handing over.
export function latestCompanionHeadline(
  reports: readonly CompanionReport[],
  nowMs = Date.now(),
): string | undefined {
  let newest: CompanionReport | undefined;
  for (const report of reports) {
    if (report.state === 'warn') continue;
    if (!newest || (report.timestampMs ?? 0) > (newest.timestampMs ?? 0)) newest = report;
  }
  if (!newest) return undefined;
  const firstLine = newest.message.split('\n', 1)[0]?.trim();
  if (!firstLine) return undefined;
  const headline = `Advisory, ${companionReportTime(newest.timestampMs, nowMs)}; ${analyzerTitle(newest.analyzerId)}: ${firstLine}`;
  return headline.length > MAX_HEADLINE_LENGTH
    ? `${headline.slice(0, MAX_HEADLINE_LENGTH - 1)}…`
    : headline;
}

import { capitalize, formatClockTime } from '$shared/lib';
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

// The one-line watch-handoff fact: a direct quote of the newest standing report, never a redraft.
// Warn entries are skipped because "report unavailable" is not standing advice worth handing over.
export function latestCompanionHeadline(reports: readonly CompanionReport[]): string | undefined {
  let newest: CompanionReport | undefined;
  for (const report of reports) {
    if (report.state === 'warn') continue;
    if (!newest || (report.timestampMs ?? 0) > (newest.timestampMs ?? 0)) newest = report;
  }
  if (!newest) return undefined;
  const firstLine = newest.message.split('\n', 1)[0]?.trim();
  if (!firstLine) return undefined;
  const clock = newest.timestampMs === undefined ? '' : ` (${formatClockTime(newest.timestampMs)})`;
  const headline = `${analyzerTitle(newest.analyzerId)}: ${firstLine}${clock}`;
  return headline.length > MAX_HEADLINE_LENGTH
    ? `${headline.slice(0, MAX_HEADLINE_LENGTH - 1)}…`
    : headline;
}

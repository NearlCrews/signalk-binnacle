import { type HandoffFact, MAX_HANDOFF_FACT_TEXT } from '$entities/handoff';
import { formatClockTime, type ReactiveClock } from '$shared/lib';

// A bounded session chronology of alarm events: what alarmed, when, and who silenced it, the
// record a squally night is otherwise unable to answer come morning. Session-only on purpose,
// never persisted: it describes what THIS station heard and did, and a stale log surviving a
// reload would read as the current watch's history.

export type AlarmLogKind = 'raised' | 'cleared' | 'silenced' | 'acknowledged' | 'muted';

export interface AlarmLogEvent {
  kind: AlarmLogKind;
  // What alarmed, in the words the navigator saw (the notification label, the mute's name).
  label: string;
  // Optional context: a depth, a remaining-mute duration, which station acted.
  detail?: string;
}

export interface AlarmLogEntry extends AlarmLogEvent {
  timeMs: number;
}

export interface AlarmLog {
  // Chronological, oldest first, bounded to the most recent MAX_ALARM_LOG_ENTRIES.
  readonly entries: readonly AlarmLogEntry[];
  record(event: AlarmLogEvent): void;
}

export const MAX_ALARM_LOG_ENTRIES = 200;

export function createAlarmLog(clock: ReactiveClock): AlarmLog {
  let entries = $state<AlarmLogEntry[]>([]);
  return {
    get entries() {
      return entries;
    },
    record(event: AlarmLogEvent) {
      const next = [...entries, { timeMs: clock.now, ...event }];
      entries =
        next.length > MAX_ALARM_LOG_ENTRIES
          ? next.slice(next.length - MAX_ALARM_LOG_ENTRIES)
          : next;
    },
  };
}

// Sentence-position words for an entry's kind, shared by the panel rows and the compact tail.
export const ALARM_LOG_KIND_LABELS: Record<AlarmLogKind, string> = {
  raised: 'Raised',
  cleared: 'Cleared',
  silenced: 'Silenced',
  acknowledged: 'Acknowledged',
  muted: 'Muted',
};

export function alarmLogLine(entry: AlarmLogEntry): string {
  const detail = entry.detail ? `, ${entry.detail}` : '';
  return `${formatClockTime(entry.timeMs)} ${ALARM_LOG_KIND_LABELS[entry.kind]}: ${entry.label}${detail}`;
}

// The most recent entries as compact lines, oldest of them first, for the watch-handoff facts.
export function alarmLogTail(log: AlarmLog, count = 5): string[] {
  return log.entries.slice(-count).map(alarmLogLine);
}

// The chronology as one watch-handoff fact, or undefined when the session has no alarm events.
// Built newest-entry-backwards so the value stays inside the handoff fact bound: an oversized
// fact would invalidate the whole snapshot at the validator.
export function alarmChronologyFact(log: AlarmLog): HandoffFact | undefined {
  const lines = alarmLogTail(log);
  if (lines.length === 0) return undefined;
  let kept: string[] = [];
  for (const line of lines.toReversed()) {
    const candidate = [line, ...kept];
    if (candidate.join('; ').length > MAX_HANDOFF_FACT_TEXT) break;
    kept = candidate;
  }
  // Even the newest line alone can outsize the bound; a clipped line still beats losing the fact.
  const value =
    kept.length > 0 ? kept.join('; ') : (lines.at(-1) ?? '').slice(0, MAX_HANDOFF_FACT_TEXT);
  return { label: 'Alarms this session', value };
}

import { untrack } from 'svelte';
import type { AlarmLogEvent } from '$features/lookout';
import { createSafetyAnnunciator, type SafetyAnnouncement } from './safety-annunciator.svelte';

export interface SafetyChannel extends SafetyAnnouncement {
  history?: {
    label: string;
    active: boolean;
    // Unavailable observations and an ownership handoff cannot establish that a hazard cleared.
    status?: 'current' | 'unavailable' | 'delegated';
    acknowledged?: boolean;
    // Some accepted local acknowledgments reset the alarm latch instead of retaining a flag.
    acknowledgeSequence?: number;
    muted?: boolean;
  };
}

// Speech and chronology share channel identity, but chronology follows hazard state, not wording
// or audio suppression. A changing range must not manufacture a new alarm every second.
export function createSafetyHistory(record: (event: AlarmLogEvent) => void) {
  const previous = new Map<string, NonNullable<SafetyChannel['history']>>();
  return {
    update(channels: readonly SafetyChannel[]): void {
      for (const { id, history } of channels) {
        if (!history) continue;
        const before = previous.get(id);
        const status = history.status ?? 'current';
        const previousStatus = before?.status ?? 'current';
        if (status !== previousStatus) {
          record({
            kind: 'status',
            label: history.label,
            source: id,
            detail:
              status === 'unavailable'
                ? 'Monitoring unavailable; last alarm state retained.'
                : status === 'delegated'
                  ? 'Server alarm now owns this concern.'
                  : 'Current alarm state available.',
          });
        }
        const actionAcknowledged =
          before !== undefined &&
          history.acknowledgeSequence !== undefined &&
          history.acknowledgeSequence > (before.acknowledgeSequence ?? 0);
        if (actionAcknowledged) {
          record({ kind: 'acknowledged', label: history.label, source: id });
        }
        if (status === 'current') {
          if (history.active !== (before?.active ?? false)) {
            record({
              kind: history.active ? 'raised' : 'cleared',
              label: history.label,
              source: id,
            });
          }
          if (
            !actionAcknowledged &&
            history.active &&
            history.acknowledged &&
            !before?.acknowledged
          ) {
            record({ kind: 'acknowledged', label: history.label, source: id });
          }
        }
        if (history.muted && !before?.muted && (before !== undefined || history.active)) {
          record({ kind: 'muted', label: history.label, source: id });
        }
        previous.set(id, {
          ...history,
          active: status === 'current' ? history.active : (before?.active ?? false),
          acknowledged: status === 'current' ? history.acknowledged : before?.acknowledged,
        });
      }
    },
  };
}

export function createSafetyController(deps: {
  channels: () => readonly SafetyChannel[];
  record: (event: AlarmLogEvent) => void;
}) {
  const annunciator = createSafetyAnnunciator();
  const history = createSafetyHistory(deps.record);
  $effect(() => {
    const channels = deps.channels();
    untrack(() => {
      annunciator.update(channels);
      history.update(channels);
    });
  });
  return annunciator;
}

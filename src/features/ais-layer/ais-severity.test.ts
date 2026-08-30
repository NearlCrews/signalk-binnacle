import { describe, expect, it, vi } from 'vitest';
import type { Assessment } from '$entities/collision';
import {
  CLEAR_RANK,
  createSeverityTracker,
  DANGER_RANK,
  severityForRank,
  UNASSESSED_RANK,
  WARNING_RANK,
} from './ais-severity';

function assessmentWith(
  contacts: { id: string; severity: 'danger' | 'warning' }[] = [],
  unassessedIds: string[] = [],
): Assessment {
  return {
    contacts: contacts.map(({ id, severity }) => ({
      id,
      position: { latitude: 0, longitude: 0 },
      cpaMeters: 100,
      tcpaSeconds: 60,
      severity,
      source: 'computed' as const,
    })),
    worst: contacts.length > 0 ? contacts[0].severity : 'clear',
    unassessed: unassessedIds.map((id) => ({
      id,
      position: { latitude: 0, longitude: 0 },
      reason: 'motion-unknown' as const,
    })),
  };
}

describe('severityForRank', () => {
  it('maps the graded ranks to their severities and everything else to clear', () => {
    expect(severityForRank(DANGER_RANK)).toBe('danger');
    expect(severityForRank(WARNING_RANK)).toBe('warning');
    expect(severityForRank(UNASSESSED_RANK)).toBe('clear');
    expect(severityForRank(CLEAR_RANK)).toBe('clear');
  });
});

describe('createSeverityTracker', () => {
  it('reads every id as clear without an assessment getter', () => {
    const tracker = createSeverityTracker();
    expect(tracker.sync()).toBe(false);
    expect(tracker.rankFor('vessels.any')).toBe(CLEAR_RANK);
  });

  it('ranks danger, warning, unassessed, and clear in that order', () => {
    const assessment = assessmentWith(
      [
        { id: 'vessels.d', severity: 'danger' },
        { id: 'vessels.w', severity: 'warning' },
      ],
      ['vessels.u'],
    );
    const tracker = createSeverityTracker(() => assessment);
    expect(tracker.sync()).toBe(true);
    expect(tracker.rankFor('vessels.d')).toBe(DANGER_RANK);
    expect(tracker.rankFor('vessels.w')).toBe(WARNING_RANK);
    expect(tracker.rankFor('vessels.u')).toBe(UNASSESSED_RANK);
    expect(tracker.rankFor('vessels.c')).toBe(CLEAR_RANK);
    expect(DANGER_RANK).toBeLessThan(WARNING_RANK);
    expect(WARNING_RANK).toBeLessThan(UNASSESSED_RANK);
    expect(UNASSESSED_RANK).toBeLessThan(CLEAR_RANK);
  });

  it('is identity-gated: the same assessment object reports no change', () => {
    const assessment = assessmentWith([{ id: 'vessels.d', severity: 'danger' }]);
    const tracker = createSeverityTracker(() => assessment);
    expect(tracker.sync()).toBe(true);
    expect(tracker.sync()).toBe(false);
  });

  it('reports no change for a fresh assessment carrying the same grades', () => {
    let assessment = assessmentWith([{ id: 'vessels.d', severity: 'danger' }]);
    const tracker = createSeverityTracker(() => assessment);
    tracker.sync();
    assessment = assessmentWith([{ id: 'vessels.d', severity: 'danger' }]);
    const onChanged = vi.fn();
    expect(tracker.sync(onChanged)).toBe(false);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('reports only the drifted ids, including a departure back to clear', () => {
    let assessment = assessmentWith(
      [
        { id: 'vessels.d', severity: 'danger' },
        { id: 'vessels.w', severity: 'warning' },
      ],
      ['vessels.u'],
    );
    const tracker = createSeverityTracker(() => assessment);
    tracker.sync();

    assessment = assessmentWith([{ id: 'vessels.w', severity: 'danger' }], ['vessels.u']);
    const onChanged = vi.fn();
    expect(tracker.sync(onChanged)).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalledWith('vessels.w', DANGER_RANK);
    expect(onChanged).toHaveBeenCalledWith('vessels.d', CLEAR_RANK);
    expect(tracker.rankFor('vessels.d')).toBe(CLEAR_RANK);
    expect(tracker.rankFor('vessels.u')).toBe(UNASSESSED_RANK);
  });

  it('keeps the graded rank when an id is somehow both graded and unassessed', () => {
    const assessment = assessmentWith([{ id: 'vessels.x', severity: 'warning' }], ['vessels.x']);
    const tracker = createSeverityTracker(() => assessment);
    tracker.sync();
    expect(tracker.rankFor('vessels.x')).toBe(WARNING_RANK);
  });

  it('reset forgets applied grades so the next sync re-reports them', () => {
    const assessment = assessmentWith([{ id: 'vessels.d', severity: 'danger' }]);
    const tracker = createSeverityTracker(() => assessment);
    tracker.sync();
    tracker.reset();
    expect(tracker.rankFor('vessels.d')).toBe(CLEAR_RANK);
    const onChanged = vi.fn();
    expect(tracker.sync(onChanged)).toBe(true);
    expect(onChanged).toHaveBeenCalledWith('vessels.d', DANGER_RANK);
  });
});

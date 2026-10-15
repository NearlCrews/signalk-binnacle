import { describe, expect, it } from 'vitest';
import { effectiveRank, SafetyStack } from './safety-stack.svelte';

interface Shape {
  id: string;
  active?: boolean;
  rank: number;
  acknowledged?: boolean;
}

function conditions(...entries: Shape[]) {
  return entries.map((entry) => ({
    id: entry.id,
    active: entry.active ?? true,
    rank: entry.rank,
    acknowledged: entry.acknowledged ?? false,
  }));
}

describe('effectiveRank', () => {
  it('sorts an acknowledged condition after every unacknowledged one', () => {
    expect(effectiveRank({ id: 'mob', active: true, rank: 0, acknowledged: true })).toBeGreaterThan(
      effectiveRank({ id: 'generic', active: true, rank: 3, acknowledged: false }),
    );
  });
});

describe('SafetyStack', () => {
  it('shows nothing while no condition is active', () => {
    const stack = new SafetyStack();
    stack.update(conditions({ id: 'mob', rank: 0, active: false }));
    expect(stack.shownId).toBeUndefined();
  });

  it('defaults to the most urgent active condition', () => {
    const stack = new SafetyStack();
    stack.update(
      conditions({ id: 'generic', rank: 3 }, { id: 'mob', rank: 0 }, { id: 'collision', rank: 1 }),
    );
    expect(stack.shownId).toBe('mob');
  });

  it('auto-promotes a newly raised higher-priority condition', () => {
    const stack = new SafetyStack();
    stack.update(conditions({ id: 'generic', rank: 3 }));
    expect(stack.shownId).toBe('generic');
    stack.update(conditions({ id: 'generic', rank: 3 }, { id: 'mob', rank: 0 }));
    expect(stack.shownId).toBe('mob');
  });

  it('moves on when the shown condition is acknowledged', () => {
    const stack = new SafetyStack();
    stack.update(conditions({ id: 'mob', rank: 0 }, { id: 'collision', rank: 1 }));
    expect(stack.shownId).toBe('mob');
    stack.update(
      conditions({ id: 'mob', rank: 0, acknowledged: true }, { id: 'collision', rank: 1 }),
    );
    expect(stack.shownId).toBe('collision');
  });

  it('honors an operator inspection over a standing higher-priority condition', () => {
    const stack = new SafetyStack();
    stack.update(conditions({ id: 'mob', rank: 0 }, { id: 'generic', rank: 3 }));
    stack.inspect('generic');
    stack.update(conditions({ id: 'mob', rank: 0 }, { id: 'generic', rank: 3 }));
    expect(stack.shownId).toBe('generic');
  });

  it('preempts an inspection only for a newly raised more-urgent condition', () => {
    const stack = new SafetyStack();
    stack.update(conditions({ id: 'collision', rank: 1 }, { id: 'generic', rank: 3 }));
    stack.inspect('generic');
    stack.update(conditions({ id: 'collision', rank: 1 }, { id: 'generic', rank: 3 }));
    expect(stack.shownId).toBe('generic');
    stack.update(
      conditions({ id: 'collision', rank: 1 }, { id: 'generic', rank: 3 }, { id: 'mob', rank: 0 }),
    );
    expect(stack.shownId).toBe('mob');
  });

  it('treats a re-raise out of acknowledged as a preempting rising edge', () => {
    const stack = new SafetyStack();
    stack.update(
      conditions({ id: 'collision', rank: 1, acknowledged: true }, { id: 'generic', rank: 3 }),
    );
    expect(stack.shownId).toBe('generic');
    stack.inspect('generic');
    stack.update(
      conditions({ id: 'collision', rank: 1, acknowledged: false }, { id: 'generic', rank: 3 }),
    );
    expect(stack.shownId).toBe('collision');
  });

  it('clears an inspection when its condition deactivates', () => {
    const stack = new SafetyStack();
    stack.update(conditions({ id: 'mob', rank: 0 }, { id: 'generic', rank: 3 }));
    stack.inspect('generic');
    stack.update(conditions({ id: 'mob', rank: 0 }, { id: 'generic', rank: 3, active: false }));
    expect(stack.shownId).toBe('mob');
  });

  it('resets completely when the last condition clears', () => {
    const stack = new SafetyStack();
    stack.update(conditions({ id: 'mob', rank: 0 }));
    stack.inspect('mob');
    stack.update(conditions({ id: 'mob', rank: 0, active: false }));
    expect(stack.shownId).toBeUndefined();
    // The next raise of the same condition is a fresh rising edge, not a remembered one.
    stack.update(conditions({ id: 'mob', rank: 0 }));
    expect(stack.shownId).toBe('mob');
  });
});

describe('SafetyStack raised time', () => {
  it('records when each condition turns active and forgets it once it clears', () => {
    const stack = new SafetyStack();
    stack.update(conditions({ id: 'anchor', rank: 2 }), 1_000);
    stack.update(conditions({ id: 'anchor', rank: 2 }, { id: 'mob', rank: 0 }), 5_000);
    expect(stack.raisedAt('anchor')).toBe(1_000);
    expect(stack.raisedAt('mob')).toBe(5_000);
    stack.update(
      conditions({ id: 'anchor', rank: 2, active: false }, { id: 'mob', rank: 0 }),
      9_000,
    );
    expect(stack.raisedAt('anchor')).toBeUndefined();
    stack.update(conditions({ id: 'anchor', rank: 2 }, { id: 'mob', rank: 0 }), 12_000);
    expect(stack.raisedAt('anchor')).toBe(12_000);
  });

  it('keeps the raised time through an acknowledgment', () => {
    const stack = new SafetyStack();
    stack.update(conditions({ id: 'shallow', rank: 3 }), 2_000);
    stack.update(conditions({ id: 'shallow', rank: 3, acknowledged: true }), 4_000);
    expect(stack.raisedAt('shallow')).toBe(2_000);
  });

  it('re-stamps a condition whose raise key changes while active, as an escalation does', () => {
    const stack = new SafetyStack();
    stack.update(
      [
        {
          id: 'collision',
          active: true,
          rank: 5,
          acknowledged: false,
          raiseKey: 'collision-warning',
        },
      ],
      1_000,
    );
    stack.update(
      [
        {
          id: 'collision',
          active: true,
          rank: 5,
          acknowledged: false,
          raiseKey: 'collision-warning',
        },
      ],
      2_000,
    );
    expect(stack.raisedAt('collision')).toBe(1_000);
    stack.update(
      [
        {
          id: 'collision',
          active: true,
          rank: 1,
          acknowledged: false,
          raiseKey: 'collision-danger',
        },
      ],
      3_000,
    );
    expect(stack.raisedAt('collision')).toBe(3_000);
  });

  it('clears every raised time when nothing is active', () => {
    const stack = new SafetyStack();
    stack.update(conditions({ id: 'mob', rank: 0 }), 1_000);
    stack.update(conditions({ id: 'mob', rank: 0, active: false }), 2_000);
    expect(stack.raisedAt('mob')).toBeUndefined();
  });
});

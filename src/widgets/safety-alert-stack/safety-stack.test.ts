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

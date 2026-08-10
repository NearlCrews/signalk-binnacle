import { describe, expect, it } from 'vitest';
import { isHandoffSnapshot, MAX_HANDOFF_FACTS, newestHandoffs } from './handoff-types';

const valid = {
  id: 'a1',
  createdAt: 1_000,
  note: 'Wind building from the southwest.',
  facts: [{ label: 'GPS fix', value: 'live, 2s ago' }],
};

describe('isHandoffSnapshot', () => {
  it('accepts a well-formed snapshot and an empty note', () => {
    expect(isHandoffSnapshot(valid)).toBe(true);
    expect(isHandoffSnapshot({ ...valid, note: '', facts: [] })).toBe(true);
  });

  it('rejects malformed, oversized, or control-character entries', () => {
    expect(isHandoffSnapshot(null)).toBe(false);
    expect(isHandoffSnapshot({ ...valid, id: '' })).toBe(false);
    expect(isHandoffSnapshot({ ...valid, createdAt: Number.NaN })).toBe(false);
    expect(isHandoffSnapshot({ ...valid, note: 'x'.repeat(501) })).toBe(false);
    expect(isHandoffSnapshot({ ...valid, note: 'bad\u0007note' })).toBe(false);
    expect(
      isHandoffSnapshot({
        ...valid,
        facts: Array.from({ length: MAX_HANDOFF_FACTS + 1 }, () => ({ label: 'a', value: 'b' })),
      }),
    ).toBe(false);
    expect(isHandoffSnapshot({ ...valid, facts: [{ label: '', value: 'b' }] })).toBe(false);
  });
});

describe('newestHandoffs', () => {
  it('sorts newest first and bounds the list', () => {
    const snapshots = Array.from({ length: 25 }, (_, index) => ({
      ...valid,
      id: `s${index}`,
      createdAt: 1_000 + index,
    }));
    const newest = newestHandoffs(snapshots);
    expect(newest).toHaveLength(20);
    expect(newest[0]?.id).toBe('s24');
    expect(newest.at(-1)?.id).toBe('s5');
  });
});

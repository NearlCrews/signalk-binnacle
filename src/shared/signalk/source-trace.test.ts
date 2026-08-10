import { describe, expect, it } from 'vitest';
import { SOURCE_CUE_WINDOW_MS, sourceCue } from './source-trace';

const NOW = 1_000_000_000;

describe('sourceCue', () => {
  it('stays quiet with no handoff: an empty trace or only the first observed source', () => {
    expect(sourceCue([], NOW)).toBeUndefined();
    expect(sourceCue([{ label: 'gps.1', epoch: NOW - 1000 }], NOW)).toBeUndefined();
  });

  it('reports a single recent handoff as a change from the prior source', () => {
    const cue = sourceCue(
      [
        { label: 'gps.1', epoch: NOW - 60_000 },
        { label: 'gps.2', epoch: NOW - 5_000 },
      ],
      NOW,
    );
    expect(cue).toEqual({ kind: 'changed', from: 'gps.1', to: 'gps.2', atEpoch: NOW - 5_000 });
  });

  it('reports alternating sources as multiple recent sources', () => {
    const cue = sourceCue(
      [
        { label: 'gps.1', epoch: NOW - 90_000 },
        { label: 'gps.2', epoch: NOW - 60_000 },
        { label: 'gps.1', epoch: NOW - 30_000 },
      ],
      NOW,
    );
    expect(cue?.kind).toBe('multiple');
    expect(cue?.kind === 'multiple' && cue.labels.sort()).toEqual(['gps.1', 'gps.2']);
  });

  it('excludes handoffs older than the window, so a settled source goes quiet', () => {
    const old = NOW - SOURCE_CUE_WINDOW_MS - 1000;
    expect(
      sourceCue(
        [
          { label: 'gps.1', epoch: old - 1000 },
          { label: 'gps.2', epoch: old },
        ],
        NOW,
      ),
    ).toBeUndefined();
  });

  it('counts only the recent handoffs when older ones have aged out', () => {
    const old = NOW - SOURCE_CUE_WINDOW_MS - 1000;
    const cue = sourceCue(
      [
        { label: 'gps.1', epoch: old - 1000 },
        { label: 'gps.2', epoch: old },
        { label: 'gps.3', epoch: NOW - 5_000 },
      ],
      NOW,
    );
    expect(cue).toEqual({ kind: 'changed', from: 'gps.2', to: 'gps.3', atEpoch: NOW - 5_000 });
  });
});

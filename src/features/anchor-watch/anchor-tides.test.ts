import { describe, expect, it } from 'vitest';
import type { TideEvent } from '$entities/tides';
import { nextTideExtremes } from './anchor-tides';

const event = (timeMs: number, kind: 'high' | 'low', heightMeters = 1): TideEvent => ({
  timeMs,
  heightMeters,
  kind,
});

describe('nextTideExtremes', () => {
  it('returns nothing for an empty window', () => {
    expect(nextTideExtremes([], 1000)).toEqual({ high: undefined, low: undefined });
  });

  it('picks the soonest upcoming high and low, skipping past events', () => {
    const events = [
      event(100, 'low'),
      event(200, 'high'),
      event(300, 'low', 0.2),
      event(400, 'high', 2.1),
      event(500, 'low'),
      event(600, 'high'),
    ];
    expect(nextTideExtremes(events, 250)).toEqual({
      high: event(400, 'high', 2.1),
      low: event(300, 'low', 0.2),
    });
  });

  it('includes an event exactly at the reference time', () => {
    const events = [event(100, 'high'), event(200, 'low')];
    expect(nextTideExtremes(events, 100)).toEqual({
      high: event(100, 'high'),
      low: event(200, 'low'),
    });
  });

  it('reports one side missing when the window only has the other kind left', () => {
    const events = [event(100, 'high'), event(200, 'low')];
    expect(nextTideExtremes(events, 150)).toEqual({ high: undefined, low: event(200, 'low') });
    expect(nextTideExtremes(events, 250)).toEqual({ high: undefined, low: undefined });
  });
});

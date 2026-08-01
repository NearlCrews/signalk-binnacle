import { describe, expect, it } from 'vitest';
import { RadarFlushGate } from './radar-flush-gate';

describe('RadarFlushGate', () => {
  it('allows a flush when nothing is outstanding', () => {
    expect(new RadarFlushGate().ready).toBe(true);
  });

  it('keeps flushing in the steady state, where each frame is consumed before the next', () => {
    const gate = new RadarFlushGate();
    // The renderer holds one frame and recycles the previous one as each new frame lands, so a
    // healthy stream must never be throttled by this gate.
    for (let tick = 0; tick < 50; tick += 1) {
      expect(gate.ready).toBe(true);
      gate.onFlush();
      if (tick > 0) gate.onConsumed();
    }
  });

  it('pauses once the consumer falls behind', () => {
    const gate = new RadarFlushGate();
    gate.onFlush();
    expect(gate.ready).toBe(true);
    gate.onFlush();
    expect(gate.ready).toBe(false);
  });

  it('does not queue further frames while the consumer stays behind', () => {
    const gate = new RadarFlushGate();
    gate.onFlush();
    gate.onFlush();
    let flushed = 0;
    for (let tick = 0; tick < 100; tick += 1) {
      if (!gate.ready) continue;
      gate.onFlush();
      flushed += 1;
    }
    expect(flushed).toBe(0);
    expect(gate.outstanding).toBe(2);
  });

  it('resumes as soon as the consumer returns a buffer', () => {
    const gate = new RadarFlushGate();
    gate.onFlush();
    gate.onFlush();
    expect(gate.ready).toBe(false);
    gate.onConsumed();
    expect(gate.ready).toBe(true);
  });

  it('cannot be given credit it was never charged for', () => {
    const gate = new RadarFlushGate();
    // A recycle from a previous stream landing after reset must not mint headroom.
    gate.onConsumed();
    gate.onConsumed();
    expect(gate.outstanding).toBe(0);
    gate.onFlush();
    gate.onFlush();
    expect(gate.ready).toBe(false);
  });

  it('clears its credit on reset, so a new stream starts unthrottled', () => {
    const gate = new RadarFlushGate();
    gate.onFlush();
    gate.onFlush();
    gate.reset();
    expect(gate.outstanding).toBe(0);
    expect(gate.ready).toBe(true);
  });
});

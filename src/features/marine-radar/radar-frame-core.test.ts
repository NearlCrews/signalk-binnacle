import { PbfWriter } from 'pbf';
import { describe, expect, it } from 'vitest';
import { RadarFrameCore } from './radar-frame-core';
import { syntheticFrames } from './synthetic-radar';

function encodeSpoke(angle: number, range: number, data: Uint8Array, bearing?: number): Uint8Array {
  const pbf = new PbfWriter();
  pbf.writeMessage(
    2,
    (_obj, w) => {
      w.writeVarintField(1, angle);
      if (bearing !== undefined) w.writeVarintField(2, bearing);
      w.writeVarintField(3, range);
      w.writeBytesField(5, data);
    },
    0,
  );
  return pbf.finish();
}

describe('RadarFrameCore', () => {
  it('integrates synthetic spokes into a flushed buffer of spokesPerRev x maxSpokeLen', () => {
    const core = new RadarFrameCore(16, 8);
    for (const frame of syntheticFrames({ spokesPerRev: 16, maxSpokeLen: 8 })) {
      core.ingest(new Uint8Array(frame));
    }
    const out = core.flush();
    expect(out.spokesPerRev).toBe(16);
    expect(out.maxSpokeLen).toBe(8);
    expect(out.buffer.byteLength).toBe(16 * 8);
    expect(new Uint8Array(out.buffer).some((b) => b !== 0)).toBe(true);
  });

  it('tracks the freshest spoke as the normalized sweep angle, undefined before any spoke', () => {
    const core = new RadarFrameCore(16, 8);
    expect(core.flush().sweep).toBeUndefined();
    for (const frame of syntheticFrames({ spokesPerRev: 16, maxSpokeLen: 8 })) {
      core.ingest(new Uint8Array(frame));
    }
    // syntheticFrames walks angles 0..15, so the last integrated spoke is column 15 of 16.
    expect(core.flush().sweep).toBeCloseTo(15 / 16, 6);
  });

  it('wraps an out-of-range spoke angle into the sweep fraction', () => {
    const core = new RadarFrameCore(16, 8);
    core.ingest(encodeSpoke(16 + 2, 1852, new Uint8Array(8)));
    // angle 18 mod 16 = 2, so the sweep parks at column 2 of 16.
    expect(core.flush().sweep).toBeCloseTo(2 / 16, 6);
  });

  it('flush returns a copy, so the live accumulator survives a transfer of the flushed buffer', () => {
    const core = new RadarFrameCore(4, 4);
    for (const frame of syntheticFrames({ spokesPerRev: 4, maxSpokeLen: 4 })) {
      core.ingest(new Uint8Array(frame));
    }
    const first = core.flush();
    structuredClone(first.buffer, { transfer: [first.buffer] });
    core.ingest(new Uint8Array(syntheticFrames({ spokesPerRev: 4, maxSpokeLen: 4 })[0]));
    expect(() => core.flush()).not.toThrow();
  });

  it('ingest returns the count of decoded spokes, and flush reports the count since the last flush', () => {
    const core = new RadarFrameCore(16, 8);
    expect(core.hasPendingSpokes).toBe(false);
    let total = 0;
    for (const frame of syntheticFrames({ spokesPerRev: 16, maxSpokeLen: 8 })) {
      total += core.ingest(new Uint8Array(frame));
    }
    expect(total).toBe(16);
    expect(core.hasPendingSpokes).toBe(true);
    expect(core.flush().spokeCount).toBe(16);
    expect(core.hasPendingSpokes).toBe(false);
    // The count resets each flush.
    expect(core.flush().spokeCount).toBe(0);
  });

  it('keeps the last positive range, so a spoke reporting range 0 does not collapse the display', () => {
    const core = new RadarFrameCore(16, 8);
    core.ingest(encodeSpoke(0, 1852, new Uint8Array(8)));
    expect(core.flush().range).toBe(1852);
    // A later spoke with range 0 (proto3 default for an omitted field) must not overwrite the good range.
    core.ingest(encodeSpoke(1, 0, new Uint8Array(8)));
    expect(core.flush().range).toBe(1852);
  });

  it('seeds the initial range from discovery so the first frame has a usable extent', () => {
    const core = new RadarFrameCore(16, 8, 926);
    expect(core.flush().range).toBe(926);
  });

  it('expires a radar-provided bearing so the renderer can fall back to vessel heading', () => {
    let now = 1000;
    const core = new RadarFrameCore(16, 8, 926, () => now);
    core.ingest(encodeSpoke(2, 926, new Uint8Array(8), 6));
    expect(core.flush().heading).toBeDefined();
    now += 5_001;
    core.ingest(encodeSpoke(3, 926, new Uint8Array(8)));
    expect(core.flush().heading).toBeUndefined();
  });

  it('a truncated frame does not corrupt the accumulator: later valid frames still integrate', () => {
    const core = new RadarFrameCore(4, 4);
    const good = syntheticFrames({ spokesPerRev: 4, maxSpokeLen: 4 });
    const truncated = new Uint8Array(good[0].slice(0, 2));
    // The worker wraps ingest in try/catch, so a decode throw on a truncated frame is swallowed there;
    // here we simulate that and assert the core still integrates subsequent valid frames.
    try {
      core.ingest(truncated);
    } catch {
      // expected: a truncated frame may throw; the worker drops it and keeps the stream alive.
    }
    for (const frame of good) core.ingest(new Uint8Array(frame));
    expect(new Uint8Array(core.flush().buffer).some((b) => b !== 0)).toBe(true);
  });
});

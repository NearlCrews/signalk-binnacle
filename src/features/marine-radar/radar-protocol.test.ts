import { PbfWriter } from 'pbf';
import { describe, expect, it } from 'vitest';
import { decodeRadarMessage } from './radar-protocol';

function encodeSpoke(): Uint8Array {
  const pbf = new PbfWriter();
  pbf.writeMessage(
    2,
    (_obj, w) => {
      w.writeVarintField(1, 10);
      w.writeVarintField(3, 1852);
      w.writeDoubleField(6, 47.5);
      w.writeDoubleField(7, -122.3);
      w.writeBytesField(5, new Uint8Array([0, 1, 2, 255]));
    },
    0,
  );
  return pbf.finish();
}

function encodeSpokes(count: number, bytesPerSpoke = 4): Uint8Array {
  const pbf = new PbfWriter();
  for (let index = 0; index < count; index += 1) {
    pbf.writeMessage(
      2,
      (_obj, writer) => {
        writer.writeVarintField(1, index);
        writer.writeVarintField(3, 1852);
        writer.writeBytesField(5, new Uint8Array(bytesPerSpoke));
      },
      0,
    );
  }
  return pbf.finish();
}

describe('decodeRadarMessage', () => {
  it('decodes a spoke with double lat/lon in degrees', () => {
    const msg = decodeRadarMessage(encodeSpoke());
    expect(msg.spokes).toHaveLength(1);
    const s = msg.spokes[0];
    expect(s.angle).toBe(10);
    expect(s.range).toBe(1852);
    expect(s.lat).toBeCloseTo(47.5, 10);
    expect(s.lon).toBeCloseTo(-122.3, 10);
    expect(Array.from(s.data)).toEqual([0, 1, 2, 255]);
  });

  it('rejects oversized messages before decoding', () => {
    expect(() => decodeRadarMessage(new Uint8Array(65), { maxMessageBytes: 64 })).toThrow(
      /too large/,
    );
  });

  it('bounds decoded spokes and drops oversized spoke data', () => {
    expect(decodeRadarMessage(encodeSpokes(4), { maxSpokes: 2 }).spokes).toHaveLength(2);
    expect(decodeRadarMessage(encodeSpokes(1, 9), { maxSpokeBytes: 8 }).spokes).toEqual([]);
  });
});

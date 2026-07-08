import { PbfWriter } from 'pbf';

type Pathology = 'clean' | 'reduce' | 'fill' | 'double';

export interface Opts {
  spokesPerRev: number;
  maxSpokeLen: number;
  pathology?: Pathology;
  revolutions?: number;
}

function encodeFrame(angle: number, range: number, data: Uint8Array): Uint8Array {
  const pbf = new PbfWriter();
  pbf.writeMessage(
    2,
    (_obj, w) => {
      w.writeVarintField(1, angle);
      w.writeVarintField(3, range);
      w.writeBytesField(5, data);
    },
    0,
  );
  return pbf.finish();
}

// A concentric-ring test pattern: a few range bins lit, plus a brighter bin that walks outward with
// the angle so the sweep is visibly directional.
function ringData(angle: number, spokesPerRev: number, maxSpokeLen: number): Uint8Array {
  const data = new Uint8Array(maxSpokeLen);
  const mid = Math.floor((angle / spokesPerRev) * maxSpokeLen);
  for (let i = 0; i < maxSpokeLen; i += 1) data[i] = i % 3 === 0 ? 1 : 0;
  data[Math.min(mid, maxSpokeLen - 1)] = 2;
  return data;
}

export function syntheticFrames(opts: Opts): Uint8Array[] {
  const { spokesPerRev, maxSpokeLen, pathology = 'clean', revolutions = 1 } = opts;
  const frames: Uint8Array[] = [];
  const range = 1852;
  for (let rev = 0; rev < revolutions; rev += 1) {
    for (let angle = 0; angle < spokesPerRev; angle += 1) {
      const data = ringData(angle, spokesPerRev, maxSpokeLen);
      if (pathology === 'fill' && angle % 2 === 1) continue;
      if (pathology === 'reduce' && angle % 4 !== 0) continue;
      frames.push(encodeFrame(angle, range, data));
      if (pathology === 'double') frames.push(encodeFrame(angle, range, data));
    }
  }
  return frames;
}

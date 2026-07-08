import { PbfReader } from 'pbf';

export interface RadarSpoke {
  angle: number;
  bearing?: number;
  range: number;
  time?: number;
  lat?: number;
  lon?: number;
  data: Uint8Array;
}

export interface RadarMessage {
  spokes: RadarSpoke[];
}

function readSpoke(pbf: PbfReader, end: number): RadarSpoke {
  const spoke: RadarSpoke = { angle: 0, range: 0, data: new Uint8Array(0) };
  while (pbf.pos < end) {
    const tag = pbf.readVarint();
    const field = tag >> 3;
    if (field === 1) spoke.angle = pbf.readVarint();
    else if (field === 2) spoke.bearing = pbf.readVarint();
    else if (field === 3) spoke.range = pbf.readVarint();
    else if (field === 4) spoke.time = pbf.readVarint();
    else if (field === 5) spoke.data = pbf.readBytes();
    else if (field === 6) spoke.lat = pbf.readDouble();
    else if (field === 7) spoke.lon = pbf.readDouble();
    else pbf.skip(tag);
  }
  return spoke;
}

// Decode a Signal K radar spoke message (RadarMessage.proto: `repeated Spoke spokes = 2`, lat/lon as
// double degrees). Unknown fields are skipped so a provider extension never breaks the decode. A
// truncated or malformed trailing spoke is salvaged: the spokes that parsed before it are kept rather
// than discarding the whole revolution's batch, so an occasional provider quirk thins the picture by one
// spoke instead of blanking it.
export function decodeRadarMessage(bytes: Uint8Array): RadarMessage {
  const pbf = new PbfReader(bytes);
  const msg: RadarMessage = { spokes: [] };
  const len = bytes.length;
  while (pbf.pos < len) {
    const tag = pbf.readVarint();
    const field = tag >> 3;
    if (field === 2) {
      // Clamp the sub-message end to the buffer so a corrupt length varint cannot drive a read past it,
      // and bail out of the loop (keeping prior spokes) if a spoke field still reads out of range.
      const end = Math.min(pbf.readVarint() + pbf.pos, len);
      try {
        msg.spokes.push(readSpoke(pbf, end));
      } catch {
        break;
      }
    } else {
      pbf.skip(tag);
    }
  }
  return msg;
}

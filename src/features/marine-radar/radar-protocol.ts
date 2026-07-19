import { PbfReader } from 'pbf';
import { MAX_RADAR_MESSAGE_BYTES, MAX_SPOKE_LENGTH, MAX_SPOKES_PER_MESSAGE } from './radar-limits';

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

export interface RadarDecodeLimits {
  maxMessageBytes?: number;
  maxSpokeBytes?: number;
  maxSpokes?: number;
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
    if (pbf.pos > end) throw new RangeError('radar spoke exceeded its message boundary');
  }
  return spoke;
}

function isValidSpoke(spoke: RadarSpoke, maxSpokeBytes: number): boolean {
  return (
    Number.isSafeInteger(spoke.angle) &&
    spoke.angle >= 0 &&
    Number.isSafeInteger(spoke.range) &&
    spoke.range >= 0 &&
    spoke.range <= 1_000_000 &&
    (spoke.bearing === undefined || (Number.isSafeInteger(spoke.bearing) && spoke.bearing >= 0)) &&
    (spoke.time === undefined || (Number.isSafeInteger(spoke.time) && spoke.time >= 0)) &&
    (spoke.lat === undefined ||
      (Number.isFinite(spoke.lat) && spoke.lat >= -90 && spoke.lat <= 90)) &&
    (spoke.lon === undefined ||
      (Number.isFinite(spoke.lon) && spoke.lon >= -180 && spoke.lon <= 180)) &&
    spoke.data.byteLength <= maxSpokeBytes
  );
}

// Decode a Signal K radar spoke message (RadarMessage.proto: `repeated Spoke spokes = 2`, lat/lon as
// double degrees). Unknown fields are skipped so a provider extension never breaks the decode. A
// truncated or malformed trailing spoke is salvaged: the spokes that parsed before it are kept rather
// than discarding the whole revolution's batch, so an occasional provider quirk thins the picture by one
// spoke instead of blanking it.
export function decodeRadarMessage(
  bytes: Uint8Array,
  limits: RadarDecodeLimits = {},
): RadarMessage {
  const maxMessageBytes = limits.maxMessageBytes ?? MAX_RADAR_MESSAGE_BYTES;
  const maxSpokeBytes = limits.maxSpokeBytes ?? MAX_SPOKE_LENGTH;
  const maxSpokes = limits.maxSpokes ?? MAX_SPOKES_PER_MESSAGE;
  if (
    !Number.isSafeInteger(maxMessageBytes) ||
    maxMessageBytes <= 0 ||
    !Number.isSafeInteger(maxSpokeBytes) ||
    maxSpokeBytes <= 0 ||
    !Number.isSafeInteger(maxSpokes) ||
    maxSpokes <= 0
  ) {
    throw new RangeError('invalid radar decode limits');
  }
  if (bytes.byteLength > maxMessageBytes) throw new RangeError('radar message is too large');
  const pbf = new PbfReader(bytes);
  const msg: RadarMessage = { spokes: [] };
  const len = bytes.length;
  while (pbf.pos < len) {
    const tag = pbf.readVarint();
    const field = tag >> 3;
    if (field === 2) {
      if (msg.spokes.length >= maxSpokes) break;
      // Clamp the sub-message end to the buffer so a corrupt length varint cannot drive a read past it,
      // and bail out of the loop (keeping prior spokes) if a spoke field still reads out of range.
      const declaredLength = pbf.readVarint();
      if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) break;
      const end = Math.min(declaredLength + pbf.pos, len);
      try {
        const spoke = readSpoke(pbf, end);
        if (isValidSpoke(spoke, maxSpokeBytes)) msg.spokes.push(spoke);
      } catch {
        break;
      }
    } else {
      pbf.skip(tag);
    }
  }
  return msg;
}

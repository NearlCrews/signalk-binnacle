import type { RadarSpoke } from './radar-protocol';

export function writeSpoke(
  buffer: Uint8Array,
  spokesPerRev: number,
  maxSpokeLen: number,
  spoke: RadarSpoke,
): void {
  if (!Number.isSafeInteger(spoke.angle) || spoke.angle < 0) return;
  const slot = (spoke.angle % spokesPerRev) * maxSpokeLen;
  const count = Math.min(spoke.data.length, maxSpokeLen);
  for (let i = 0; i < count; i += 1) buffer[slot + i] = spoke.data[i];
  for (let i = count; i < maxSpokeLen; i += 1) buffer[slot + i] = 0;
}

export function headingSpokes(angle: number, bearing: number, spokesPerRev: number): number {
  return (((bearing - angle) % spokesPerRev) + spokesPerRev) % spokesPerRev;
}

export function spokesToRadians(spokes: number, spokesPerRev: number): number {
  return (spokes * 2 * Math.PI) / spokesPerRev;
}

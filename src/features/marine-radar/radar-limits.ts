export const MAX_RADARS = 16;
export const MAX_RADAR_CONTROLS = 256;
export const MAX_RADAR_LEGEND_ENTRIES = 256;
export const MAX_RADAR_ID_LENGTH = 128;
export const MAX_RADAR_TEXT_LENGTH = 256;
export const MAX_RADAR_URL_LENGTH = 2_048;
export const MAX_SPOKES_PER_REVOLUTION = 8_192;
export const MAX_SPOKE_LENGTH = 4_096;
export const MAX_RADAR_FRAME_BYTES = 16 * 1024 * 1024;
export const MAX_RADAR_MESSAGE_BYTES = 4 * 1024 * 1024;
export const MAX_SPOKES_PER_MESSAGE = 8_192;
export const MAX_RADAR_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_RADAR_COPY_BYTES_PER_SECOND = 32 * 1024 * 1024;

export function isSafeRadarGeometry(spokesPerRev: number, maxSpokeLen: number): boolean {
  return (
    Number.isSafeInteger(spokesPerRev) &&
    spokesPerRev > 0 &&
    spokesPerRev <= MAX_SPOKES_PER_REVOLUTION &&
    Number.isSafeInteger(maxSpokeLen) &&
    maxSpokeLen > 0 &&
    maxSpokeLen <= MAX_SPOKE_LENGTH &&
    spokesPerRev * maxSpokeLen <= MAX_RADAR_FRAME_BYTES
  );
}

export function radarFlushHz(spokesPerRev: number, maxSpokeLen: number): number {
  const frameBytes = spokesPerRev * maxSpokeLen;
  if (!isSafeRadarGeometry(spokesPerRev, maxSpokeLen)) return 1;
  return Math.max(1, Math.min(15, Math.floor(MAX_RADAR_COPY_BYTES_PER_SECOND / frameBytes)));
}

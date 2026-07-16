// PMTiles directories and tile payloads are expected to be compact range reads. Bounding each read
// prevents a corrupt or hostile archive from forcing a huge ArrayBuffer or block-index allocation.
const MAX_PMTILES_RANGE_LENGTH = 64 * 1024 * 1024;

export function requestedRangeEnd(offset: number, length: number): number {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > MAX_PMTILES_RANGE_LENGTH ||
    offset > Number.MAX_SAFE_INTEGER - (length - 1)
  ) {
    throw new RangeError('PMTiles range request requires safe, nonnegative integer bounds.');
  }
  return offset + length - 1;
}

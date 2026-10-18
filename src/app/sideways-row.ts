// Whether a phone held sideways sets its icon tiles beside the readouts instead of on a row of their
// own beneath them: whenever that leaves the bar no taller. At the default text size the readouts
// then fit one row beside the tiles; at very large text they wrap either way, and beside the tiles
// they save the tiles' row. Every length is in CSS pixels, as measured on the page.
export interface SidewaysRoom {
  // The bar between its two slim ends.
  middle: number;
  // The readout column floor, and a readout's height.
  cellWidth: number;
  cellHeight: number;
  // One icon tile, the gap between two, and its height.
  tileWidth: number;
  tileGap: number;
  tileHeight: number;
  // The bar's row gap, which also insets the tiles from the readouts beside them.
  gap: number;
}

export function tilesBeside(room: SidewaysRoom, tiles: number, readouts: number): boolean {
  if (tiles === 0) return true;
  const tilesWidth = tiles * room.tileWidth + (tiles - 1) * room.tileGap + room.gap;
  const stackedColumns = Math.floor(room.middle / room.cellWidth);
  const besideColumns = Math.floor((room.middle - tilesWidth) / room.cellWidth);
  if (stackedColumns < 1 || besideColumns < 1) return false;
  const readoutsHeight = (columns: number): number => {
    const rows = Math.ceil(readouts / columns);
    return rows * room.cellHeight + (rows - 1) * room.gap;
  };
  const stacked = readoutsHeight(stackedColumns) + room.gap + room.tileHeight;
  const beside = Math.max(readoutsHeight(besideColumns), room.tileHeight);
  return beside <= stacked;
}

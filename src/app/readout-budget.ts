// Which readouts the bar can hold in the columns it has, giving way whole and in a fixed order:
// the time first, then the vessel position (two columns), then the compact set (AIS moves into the
// Status cell, and COG or HDG shows by context), and on a bar of one readout column (very large
// text on a phone) that context cell too, so the bar never stacks four readouts. SOG, Depth, and the
// Status cell never give way; when even they are too wide, whole cells wrap onto further rows on the
// same columns.
export interface ReadoutBudget {
  time: boolean;
  position: boolean;
  compact: boolean;
  // Whether the compact set's context cell (COG or HDG) has room.
  context: boolean;
}

// Status, AIS, SOG, COG, HDG, and Depth.
const CORE_CELLS = 6;
const POSITION_CELLS = 2;
const TIME_CELLS = 1;

export function readoutBudget(columns: number, extras: number): ReadoutBudget {
  const core = CORE_CELLS + extras;
  if (core + POSITION_CELLS + TIME_CELLS <= columns) {
    return { time: true, position: true, compact: false, context: true };
  }
  if (core + POSITION_CELLS <= columns) {
    return { time: false, position: true, compact: false, context: true };
  }
  if (core <= columns) return { time: false, position: false, compact: false, context: true };
  return { time: false, position: false, compact: true, context: columns > 1 };
}

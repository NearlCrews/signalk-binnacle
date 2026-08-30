// Chart course vectors project a vessel ahead along its COG at its SOG for one shared window:
// ten minutes, long enough to read a crossing situation and short enough that the tip is still a
// prediction worth trusting. AIS targets and the own-ship predictor draw from this one constant so
// their vectors stay directly comparable on the chart.
const COURSE_VECTOR_MINUTES = 10;
export const COURSE_VECTOR_SECONDS = COURSE_VECTOR_MINUTES * 60;

// COG is meaningless while the boat is effectively stationary: below this speed (about 0.3 kt)
// GPS scatter dominates the reported course. The status strip dashes its COG readout at this
// floor and the own-ship predictor hides at it.
export const COG_MIN_SOG_MPS = 0.15;

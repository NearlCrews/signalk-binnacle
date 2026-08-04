// The overlay id lives beside the layer ids rather than in measure-overlay.ts so a consumer that
// only needs the id (the chart host's critical-overlay lookup) does not pull the lazily-loaded
// renderer into the main chunk.
export const MEASURE_OVERLAY_ID = 'measure';

export const MEASURE_LAYER_IDS = [
  'binnacle-measure-line',
  'binnacle-measure-hit',
  'binnacle-measure-selected',
  'binnacle-measure-vertex',
  'binnacle-measure-leg-label',
  'binnacle-measure-label',
] as const;

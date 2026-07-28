export const TIDES_SOURCE_ID = 'binnacle-tides';
export const TIDES_SELECTED_LAYER = 'binnacle-tides-selected';
export const TIDES_TIDE_LAYER = 'binnacle-tides-tide';
export const TIDES_CURRENT_LAYER = 'binnacle-tides-current';
export const TIDES_GLYPH_LAYER = 'binnacle-tides-glyph';
export const TIDES_LABEL_LAYER = 'binnacle-tides-label';
export const TIDES_HIT_LAYER = 'binnacle-tides-hit';

export const TIDES_VISUAL_LAYERS = [
  TIDES_SELECTED_LAYER,
  TIDES_TIDE_LAYER,
  TIDES_CURRENT_LAYER,
  TIDES_GLYPH_LAYER,
  TIDES_LABEL_LAYER,
];

export const TIDES_LAYERS = [...TIDES_VISUAL_LAYERS, TIDES_HIT_LAYER];

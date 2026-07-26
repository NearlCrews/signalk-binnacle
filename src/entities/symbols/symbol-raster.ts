import { decodeSvgToImageData, type MapThemePaint } from '$shared/map';
import { mapLuminanceToRed } from './night-red';

// Rasterized at 2x and registered with pixelRatio 2, matching the built-in note icons.
export const SYMBOL_PIXEL_RATIO = 2;
// An SVG that decodes without an intrinsic size renders at the glyph grid the built-ins use.
const DEFAULT_SVG_PX = 24;
// Cap the rendered size so a poster-sized user SVG cannot blanket the chart; the effective
// scale shrinks with it so the anchor math stays true.
const MAX_CSS_PX = 128;

export interface SymbolRaster {
  image: ImageData;
  // CSS pixel size as displayed at icon-size 1, and the effective scale actually applied
  // (the requested scale, reduced if the size cap bit), for the anchor-offset math.
  cssWidth: number;
  cssHeight: number;
  scale: number;
}

export type RasterizeSymbol = (
  svgText: string,
  scale: number,
  paint: MapThemePaint,
) => Promise<SymbolRaster | null>;

// MapLibre has no per-pixel icon anchor (icon-anchor is nine named positions), so the documented
// top-left anchor pixel is mapped to icon-offset: the offset that moves the centered icon so the
// anchor pixel lands on the geographic point. Offset units are icon CSS pixels, scaled by
// icon-size at render, so the mapping holds across the zoom-interpolated sizes.
export function anchorOffset(
  cssWidth: number,
  cssHeight: number,
  scale: number,
  anchor: [number, number] | undefined,
): [number, number] {
  if (!anchor) return [0, 0];
  return [cssWidth / 2 - anchor[0] * scale, cssHeight / 2 - anchor[1] * scale];
}

// Size and draw the decoded SVG onto a canvas, capping the rendered size and (at night-red) running
// the luminance-to-red pixel pass so a user SVG can never break the theme. Browser only: the node
// test environment returns null via decodeSvgToImageData, which callers treat as the degrade signal.
export const rasterizeSymbolSvg: RasterizeSymbol = (svgText, scale, paint) =>
  decodeSvgToImageData(svgText, (img, ctx) => {
    const naturalWidth = img.naturalWidth || DEFAULT_SVG_PX;
    const naturalHeight = img.naturalHeight || DEFAULT_SVG_PX;
    const fit = MAX_CSS_PX / Math.max(naturalWidth, naturalHeight);
    const effectiveScale = Math.min(scale, fit);
    const width = Math.max(1, Math.round(naturalWidth * effectiveScale * SYMBOL_PIXEL_RATIO));
    const height = Math.max(1, Math.round(naturalHeight * effectiveScale * SYMBOL_PIXEL_RATIO));
    const { canvas } = ctx;
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    if (paint.theme === 'night-red') mapLuminanceToRed(image.data);
    return {
      image,
      cssWidth: width / SYMBOL_PIXEL_RATIO,
      cssHeight: height / SYMBOL_PIXEL_RATIO,
      scale: effectiveScale,
    };
  });

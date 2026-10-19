// The root font size in pixels: what one rem measures, which follows the user's text size setting.
export function rootFontPx(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import INSTRUMENTS_CSS from '../../styles/instruments.css?raw';
import TOKENS_CSS from '../../styles/tokens.css?raw';
import NumericTile from './NumericTile.svelte';
import type { TileReading } from './tile-catalog';

// Browser-only suite: the hero clamp resolves cqi against the tile's laid-out content-box inline
// size, which only a real layout engine computes. The stylesheet text contract lives in
// tiles.svelte.test.ts.

const LIVE: TileReading = { state: 'live', value: '7.4', unit: 'kn', siValue: 3.8 };
const REM = 16;
const HERO_FLOOR = 1.75 * REM;
const HERO_CAP = 4 * REM;
const HERO_SCALE = 0.17;
const HERO_LEADING = 1.1;

let sheet: HTMLStyleElement;
beforeAll(() => {
  sheet = document.createElement('style');
  sheet.textContent = `${TOKENS_CSS}\n${INSTRUMENTS_CSS}`;
  document.head.append(sheet);
});
afterAll(() => {
  sheet.remove();
});

const mounted: Array<() => void> = [];
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
});

function mountTileAt(width: number, kind?: string): HTMLElement {
  const target = document.createElement('div');
  // A one-column grid mirrors the dock: the tile stretches to the track, so the wrapper width
  // sets the tile width under test.
  target.style.cssText = `display: grid; grid-template-columns: 1fr; width: ${width}px`;
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(NumericTile, {
      target,
      props: { label: 'SOG', reading: LIVE, zone: 'normal', sensorGloss: 'No speed sensor', kind },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  return target;
}

// cqi is 1% of the query container's content-box inline size, so the expected hero size derives
// from the tile's own laid-out content box, not the wrapper width.
function tileContentInlineSize(target: HTMLElement): number {
  const tile = target.querySelector('.tile');
  if (!(tile instanceof HTMLElement)) throw new Error('no tile');
  const style = getComputedStyle(tile);
  return (
    tile.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
  );
}

function heroFontSize(target: HTMLElement): number {
  const num = target.querySelector('.num');
  if (!num) throw new Error('no hero numeral');
  return Number.parseFloat(getComputedStyle(num).fontSize);
}

function valueReserve(target: HTMLElement): number {
  const value = target.querySelector('.value');
  if (!value) throw new Error('no value slot');
  return Number.parseFloat(getComputedStyle(value).minHeight);
}

describe('tile hero container scaling', () => {
  it('holds the floor on a narrow dock tile', () => {
    const target = mountTileAt(150);
    expect(tileContentInlineSize(target) * HERO_SCALE).toBeLessThan(HERO_FLOOR);
    expect(heroFontSize(target)).toBeCloseTo(HERO_FLOOR, 1);
  });

  it('grows with the tile width past the floor', () => {
    const target = mountTileAt(320);
    const expected = tileContentInlineSize(target) * HERO_SCALE;
    expect(expected).toBeGreaterThan(HERO_FLOOR);
    expect(expected).toBeLessThan(HERO_CAP);
    expect(heroFontSize(target)).toBeCloseTo(expected, 1);
  });

  it('caps at 4rem on a wide tile', () => {
    const target = mountTileAt(520);
    expect(tileContentInlineSize(target) * HERO_SCALE).toBeGreaterThan(HERO_CAP);
    expect(heroFontSize(target)).toBeCloseTo(HERO_CAP, 1);
  });

  it('reserves the value slot from the same scaled size, so arrival cannot jump the layout', () => {
    const target = mountTileAt(320);
    expect(valueReserve(target)).toBeCloseTo(heroFontSize(target) * HERO_LEADING, 1);
  });

  it('keeps the position tile at the fixed secondary readout size at any width', () => {
    const target = mountTileAt(520, 'position');
    expect(heroFontSize(target)).toBeCloseTo(1.25 * REM, 1);
    expect(valueReserve(target)).toBeCloseTo(1.25 * REM * HERO_LEADING, 1);
  });
});

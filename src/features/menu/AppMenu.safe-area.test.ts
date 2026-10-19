import { describe, expect, it } from 'vitest';
import TOKENS from '../../styles/tokens.css?raw';
import APP_MENU from './AppMenu.svelte?raw';

describe('mobile app-menu system-bar clearance', () => {
  it('rests the sheet on the status bar, which carries the system-bar clearance itself', () => {
    expect(APP_MENU).toContain('inset-block-end: var(--bar-block-size, 0px)');
    expect(APP_MENU).not.toContain('var(--system-bar-clearance)');
  });

  it('keeps controls clear of landscape-edge system chrome and a top cutout', () => {
    expect(APP_MENU).toContain('env(safe-area-inset-left, 0px)');
    expect(APP_MENU).toContain('env(safe-area-inset-right, 0px)');
    expect(APP_MENU).toContain('var(--room-above-bar)');
    expect(TOKENS).toMatch(/--room-above-bar: calc\([^;]*var\(--chrome-inset-top\)/u);
  });
});

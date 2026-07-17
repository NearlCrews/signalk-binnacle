import { describe, expect, it } from 'vitest';
import APP_MENU from './AppMenu.svelte?raw';

describe('mobile app-menu system-bar clearance', () => {
  it('keeps controls clear of bottom and landscape-edge system chrome', () => {
    expect(APP_MENU).toContain(
      'padding-block-end: calc(var(--space-3) + var(--system-bar-clearance))',
    );
    expect(APP_MENU).toContain('env(safe-area-inset-left, 0px)');
    expect(APP_MENU).toContain('env(safe-area-inset-right, 0px)');
  });
});

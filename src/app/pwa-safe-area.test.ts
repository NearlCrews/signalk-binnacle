import { describe, expect, it } from 'vitest';
import INDEX_HTML from '../../index.html?raw';
import PANELS_CSS from '../styles/panels.css?raw';
import TOKENS_CSS from '../styles/tokens.css?raw';
import APP from './App.svelte?raw';
import STATUS_STRIP from './StatusStrip.svelte?raw';

describe('installed PWA system-bar clearance', () => {
  it('allows the viewport to expose browser safe-area insets', () => {
    expect(INDEX_HTML).toContain('viewport-fit=cover');
  });

  it('keeps a fallback clearance for installed touch PWAs', () => {
    expect(TOKENS_CSS).toContain('--system-bar-clearance: env(safe-area-inset-bottom, 0px)');
    expect(TOKENS_CSS).toMatch(
      /@media \(display-mode: standalone\) and \(pointer: coarse\)[\s\S]*--system-bar-clearance:\s*max\(/,
    );
    expect(TOKENS_CSS).toContain('var(--system-bar-fallback)');
  });

  it('applies bottom and landscape-edge clearance to the status strip', () => {
    expect(STATUS_STRIP).toContain(
      'padding-block-end: calc(var(--space-2) + var(--system-bar-clearance))',
    );
    expect(STATUS_STRIP).toContain('env(safe-area-inset-left, 0px)');
    expect(STATUS_STRIP).toContain('env(safe-area-inset-right, 0px)');
  });

  // A landscape phone is wider than the 600px phone breakpoint, so it lays out with the wide rules.
  // Those must reserve the notch side too, or the menu button and panel headers sit under it.
  it('keeps the wide top bar, docked panels, and instrument dock clear of a landscape notch', () => {
    const topbar = APP.slice(APP.indexOf('.topbar {'), APP.indexOf('.topbar > *'));
    expect(topbar).toContain('env(safe-area-inset-left, 0px)');
    expect(topbar).toContain('env(safe-area-inset-right, 0px)');
    const slot = PANELS_CSS.slice(PANELS_CSS.indexOf('.panel-slot {'));
    expect(slot.slice(0, slot.indexOf('}'))).toContain(
      'inset-inline-start: env(safe-area-inset-left, 0px)',
    );
    const end = slot.slice(slot.indexOf('.panel-slot--end {'));
    expect(end.slice(0, end.indexOf('}'))).toContain(
      'inset-inline-end: env(safe-area-inset-right, 0px)',
    );
    const dock = APP.slice(APP.indexOf('.binnacle-shell > :global(.instruments) {'));
    const docked = dock.slice(0, dock.indexOf('}'));
    expect(docked).toContain('padding-inline-end: env(safe-area-inset-right, 0px)');
    expect(dock.slice(0, dock.indexOf('/* The strip'))).toMatch(
      /padding-inline:\s*env\(safe-area-inset-left, 0px\)\s+env\(safe-area-inset-right, 0px\)/,
    );
  });
});

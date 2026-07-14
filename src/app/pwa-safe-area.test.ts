import { describe, expect, it } from 'vitest';
import INDEX_HTML from '../../index.html?raw';
import TOKENS_CSS from '../styles/tokens.css?raw';
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
});

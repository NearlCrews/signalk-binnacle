import { describe, expect, it } from 'vitest';
import INDEX_HTML from '../../index.html?raw';
import MANIFEST from '../../static/manifest.webmanifest?raw';
import PANELS_CSS from '../styles/panels.css?raw';
import TOKENS_CSS from '../styles/tokens.css?raw';
import VENDOR_CSS from '../styles/vendor.css?raw';
import APP from './App.svelte?raw';
import STATUS_STRIP from './StatusStrip.svelte?raw';

// Sources from the layers below, read as text through a glob so a contract test adds no import
// edge across the slice boundaries.
const lower = import.meta.glob<string>(
  [
    '/src/views/plotter/PlotterView.svelte',
    '/src/widgets/chart-canvas/ChartCanvas.svelte',
    '/src/widgets/chart-canvas/VesselOffScreenIndicator.svelte',
  ],
  { query: '?raw', import: 'default', eager: true },
);
const PLOTTER = lower['/src/views/plotter/PlotterView.svelte'] ?? '';
const CHART_CANVAS = lower['/src/widgets/chart-canvas/ChartCanvas.svelte'] ?? '';
const OFF_SCREEN = lower['/src/widgets/chart-canvas/VesselOffScreenIndicator.svelte'] ?? '';

// The declaration block of the first rule whose selector starts at `selector`.
function rule(source: string, selector: string): string {
  const at = source.indexOf(selector);
  if (at < 0) throw new Error(`No rule ${selector}`);
  return source.slice(at, source.indexOf('}', at));
}

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
  // Those must reserve the notch side too, or the menu end and panel headers sit under it.
  it('keeps the status bar, docked panels, and instrument dock clear of a landscape notch', () => {
    expect(TOKENS_CSS).toContain(
      '--chrome-inset-start: calc(var(--space-3) + env(safe-area-inset-left, 0px))',
    );
    expect(TOKENS_CSS).toContain(
      '--chrome-inset-end: calc(var(--space-3) + env(safe-area-inset-right, 0px))',
    );
    const slot = rule(PANELS_CSS, '.panel-slot {');
    expect(slot).toContain('inset-inline-start: env(safe-area-inset-left, 0px)');
    expect(rule(PANELS_CSS, '.panel-slot--end {')).toContain(
      'inset-inline-end: env(safe-area-inset-right, 0px)',
    );
    const docked = rule(APP, '.binnacle-shell > :global(.instruments) {');
    expect(docked).toContain('padding-inline-end: env(safe-area-inset-right, 0px)');
    const dock = APP.slice(APP.indexOf('.binnacle-shell > :global(.instruments) {'));
    expect(dock.slice(0, dock.indexOf('/* The strip'))).toMatch(
      /padding-inline:\s*env\(safe-area-inset-left, 0px\)\s+env\(safe-area-inset-right, 0px\)/,
    );
  });

  // With no top bar the chart reaches the top of the screen, where an edge-to-edge status bar or a
  // cutout can overlay it: every control floating at the chart's top clears that inset.
  it('keeps everything at the top of the chart clear of a top inset', () => {
    expect(TOKENS_CSS).toContain('--chrome-inset-top: env(safe-area-inset-top, 0px)');
    expect(rule(PANELS_CSS, '.panel-slot {')).toContain('inset-block: var(--chrome-inset-top) 0');
    expect(rule(VENDOR_CSS, '.chart-canvas .maplibregl-ctrl-top-right {')).toContain(
      'var(--chrome-inset-top)',
    );
    expect(rule(PLOTTER, '.banner-slot {')).toContain('var(--chrome-inset-top)');
    expect(rule(PLOTTER, '.top-banner-stack {')).toContain('var(--chrome-inset-top)');
    expect(rule(PLOTTER, '.safety-rail {')).toContain('var(--chrome-inset-top)');
    expect(rule(CHART_CANVAS, '.context-hint {')).toContain('var(--chrome-inset-top)');
    expect(OFF_SCREEN).toContain('var(--chrome-inset-top)');
    const dock = APP.slice(APP.indexOf('.binnacle-shell > :global(.instruments) {'));
    expect(dock.match(/padding-block-start: var\(--chrome-inset-top\)/g)).toHaveLength(2);
  });

  it('has no top bar, so the installed app keeps its own title bar', () => {
    expect(APP).not.toMatch(/\n\.topbar[\s{]/);
    expect(APP).not.toContain('titlebar-area');
    expect(MANIFEST).not.toContain('window-controls-overlay');
  });
});

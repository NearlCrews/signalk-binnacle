import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import BatteryBar from './BatteryBar.svelte';
import RotNeedle from './RotNeedle.svelte';
import Sparkline from './Sparkline.svelte';
import { createTileHistory } from './tile-history.svelte';

// SSR-only suite (node environment, no DOM). Assertions are substring checks on the rendered body.

describe('Sparkline', () => {
  it('renders nothing with fewer than 2 points', () => {
    expect(render(Sparkline, { props: { points: [] } }).body).not.toContain('<svg');
    expect(render(Sparkline, { props: { points: [5] } }).body).not.toContain('<svg');
  });

  it('renders a polyline for 3 points', () => {
    const html = render(Sparkline, { props: { points: [0, 5, 10] } }).body;
    expect(html).toContain('<polyline');
    // x spreads 0, 50, 100; y inverts so min (0) is 22 and max (10) is 2.
    expect(html).toContain('points="0,22 50,12 100,2"');
  });

  it('draws a flat midline when all points are equal', () => {
    const html = render(Sparkline, { props: { points: [5, 5, 5] } }).body;
    expect(html).toContain('points="0,12 50,12 100,12"');
  });

  it('is aria-hidden without a label', () => {
    const html = render(Sparkline, { props: { points: [1, 2, 3] } }).body;
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
  });

  it('exposes role and aria-label when a label is passed', () => {
    const html = render(Sparkline, { props: { points: [1, 2, 3], label: 'Depth trend' } }).body;
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Depth trend"');
    expect(html).not.toContain('aria-hidden="true"');
  });
});

describe('BatteryBar', () => {
  it('scales the fill width with the fraction', () => {
    const html = render(BatteryBar, { props: { fraction: 0.5 } }).body;
    // 30 units of travel * 0.5 = 15.
    expect(html).toContain('class="fill"');
    expect(html).toContain('width="15"');
  });

  it('clamps the fill width for a fraction above 1', () => {
    const html = render(BatteryBar, { props: { fraction: 2 } }).body;
    expect(html).toContain('width="30"');
  });

  it('renders no fill rect for an undefined fraction', () => {
    const html = render(BatteryBar, { props: { fraction: undefined } }).body;
    expect(html).not.toContain('class="fill"');
    // The outline (body plus terminal nub) still renders.
    expect(html).toContain('<svg');
  });

  it('tints the fill by state', () => {
    const warn = render(BatteryBar, { props: { fraction: 0.5, state: 'warning' } }).body;
    expect(warn).toContain('fill="var(--warning)"');
    const alarm = render(BatteryBar, { props: { fraction: 0.5, state: 'alarm' } }).body;
    expect(alarm).toContain('fill="var(--alarm)"');
  });

  it('is aria-hidden', () => {
    const html = render(BatteryBar, { props: { fraction: 0.5 } }).body;
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('RotNeedle', () => {
  it('clamps the needle rotation at the full-scale rate', () => {
    // 1 rad/s is far above 30 deg/min, so the needle pins to +60 (starboard).
    const html = render(RotNeedle, { props: { radPerSec: 1, maxDegPerMin: 30 } }).body;
    expect(html).toContain('rotate(60 20 20)');
  });

  it('rotates counter-clockwise for a port turn', () => {
    const html = render(RotNeedle, { props: { radPerSec: -1, maxDegPerMin: 30 } }).body;
    expect(html).toContain('rotate(-60 20 20)');
  });

  it('omits the needle when the value is undefined', () => {
    const html = render(RotNeedle, { props: { radPerSec: undefined } }).body;
    expect(html).not.toContain('class="needle"');
    // The dial (arc plus center tick) still renders.
    expect(html).toContain('<svg');
  });

  it('is aria-hidden', () => {
    const html = render(RotNeedle, { props: { radPerSec: 0.001 } }).body;
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('createTileHistory', () => {
  it('trims the buffer to the capacity, oldest first', () => {
    const hist = createTileHistory();
    for (let i = 0; i < 65; i++) hist.sample('a', i, i * 5000);
    const series = hist.series('a');
    expect(series.length).toBe(60);
    expect(series[0]).toBe(5);
    expect(series[59]).toBe(64);
  });

  it('drops a sample taken sooner than the min spacing', () => {
    const hist = createTileHistory();
    hist.sample('a', 10, 0);
    hist.sample('a', 20, 4999); // dropped: under 5000 ms since the last accepted sample
    hist.sample('a', 30, 5000); // accepted: exactly at the spacing boundary
    expect(hist.series('a')).toEqual([10, 30]);
  });

  it('skips undefined values', () => {
    const hist = createTileHistory();
    hist.sample('a', undefined, 0);
    expect(hist.series('a')).toEqual([]);
  });

  it('prunes buffers for ids no longer live', () => {
    const hist = createTileHistory();
    hist.sample('a', 1, 0);
    hist.sample('b', 2, 0);
    hist.prune(new Set(['a']));
    expect(hist.series('a')).toEqual([1]);
    expect(hist.series('b')).toEqual([]);
  });

  it('honors custom capacity and spacing options', () => {
    const hist = createTileHistory({ capacity: 3, minSpacingMs: 1000 });
    hist.sample('a', 1, 0);
    hist.sample('a', 2, 1000);
    hist.sample('a', 3, 2000);
    hist.sample('a', 4, 3000);
    expect(hist.series('a')).toEqual([2, 3, 4]);
  });
});

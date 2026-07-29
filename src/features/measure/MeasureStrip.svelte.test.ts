import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { MeasureStore } from '$entities/measure';
import type { UnitsStore } from '$entities/units';
import MeasureStrip from './MeasureStrip.svelte';

function renderStrip(measure: MeasureStore, onMoveSelectedToCenter?: () => void): string {
  return render(MeasureStrip, {
    props: { measure, units: { mode: 'metric' } as UnitsStore, onMoveSelectedToCenter },
  }).body;
}

describe('MeasureStrip', () => {
  it('stays absent until measurement starts', () => {
    expect(renderStrip(new MeasureStore())).not.toContain('<aside');
  });

  it('gives the next tap instruction at each stage', () => {
    const measure = new MeasureStore();
    measure.start();
    expect(renderStrip(measure)).toContain('Tap the chart to set the start point');
    measure.add({ latitude: 0, longitude: 0 });
    expect(renderStrip(measure)).toContain('Tap the chart to set the next point');
    measure.add({ latitude: 0.001, longitude: 0 });
    expect(renderStrip(measure)).toContain('2 points. Tap the chart to add another');
  });

  it('shows the latest leg, true bearing, and total', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    measure.add({ latitude: 0.001, longitude: 0 });
    measure.add({ latitude: 0.002, longitude: 0 });
    const body = renderStrip(measure);
    expect(body).toContain('Leg <b>111 m</b>');
    expect(body).toContain('Bearing <b>000</b>°T');
    expect(body).toContain('Total <b>222 m</b>');
  });

  it('shows a compact selected-point editor with both adjacent leg readouts', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    measure.add({ latitude: 0.001, longitude: 0 });
    measure.add({ latitude: 0.002, longitude: 0 });
    measure.selectIndex(1);
    const body = renderStrip(measure);
    expect(body).toContain('Point 2 selected');
    expect(body).toContain('Point 2 of 3');
    expect(body).toContain('Previous measurement point');
    expect(body).toContain('Next measurement point');
    expect(body).toContain('Move point');
    expect(body).toContain('Delete measurement point 2');
    expect(body).toContain('Previous');
    expect(body).toContain('Next');
  });

  it('makes move mode visible and exposes the keyboard chart-center action', () => {
    const measure = new MeasureStore();
    measure.start();
    measure.add({ latitude: 0, longitude: 0 });
    measure.selectIndex(0);
    measure.armMove();
    const body = renderStrip(measure, () => {});
    expect(body).toContain('drag it or tap a new chart position. Escape cancels.');
    expect(body).toContain('Cancel move');
    expect(body).toContain('Move to chart center');
  });
});

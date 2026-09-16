import { flushSync, mount, tick, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import { MeasureStore } from '$entities/measure';
import type { UnitsStore } from '$entities/units';
import MeasureStrip from './MeasureStrip.svelte';

describe('measurement coordinate controls', () => {
  it.each(['Cancel', 'Escape'])(
    'returns focus to Clear and preserves measurement when %s dismisses its confirmation',
    async (action) => {
      const measure = new MeasureStore();
      measure.start();
      measure.add({ latitude: 42, longitude: -83 });
      measure.add({ latitude: 43, longitude: -82 });
      const target = document.createElement('div');
      document.body.append(target);
      const component = mount(MeasureStrip, {
        target,
        props: { measure, units: { mode: 'metric' } as UnitsStore },
      });
      flushSync();
      try {
        const clear = [...target.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === 'Clear',
        );
        if (!clear) throw new Error('Missing clear measurement control');
        clear.click();
        flushSync();
        const cancel = [...target.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === 'Cancel',
        );
        if (!cancel) throw new Error('Missing clear confirmation Cancel');
        expect(document.activeElement).toBe(cancel);
        if (action === 'Escape')
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
        else cancel.click();
        flushSync();
        await tick();
        expect(document.activeElement).toBe(clear);
        expect(measure.active).toBe(true);
        expect(measure.vertices).toHaveLength(2);
        expect(target.textContent).not.toContain('Clear all 2 measurement points?');
        if (action === 'Escape') {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
          flushSync();
          expect(measure.active).toBe(false);
        }
      } finally {
        await unmount(component);
        target.remove();
      }
    },
  );

  it('adds initial and subsequent points, then moves, deletes, and undoes through existing store actions', async () => {
    const measure = new MeasureStore();
    measure.start();
    const target = document.createElement('div');
    document.body.append(target);
    const component = mount(MeasureStrip, {
      target,
      props: {
        measure,
        units: { mode: 'metric' } as UnitsStore,
        getChartCenter: () => ({ latitude: 42, longitude: -83 }),
      },
    });
    flushSync();
    const click = (label: string) => {
      const button = [...target.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === label,
      );
      if (!button) throw new Error(`Missing button ${label}`);
      button.click();
      flushSync();
    };
    const latitude = async (value: number) => {
      const input = target.querySelector<HTMLInputElement>('input[aria-label^="Latitude"]');
      if (!input) throw new Error('Missing latitude input');
      input.value = String(value);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      flushSync();
      await tick();
    };
    try {
      click('Enter measurement coordinates');
      click('Add at chart center');
      await latitude(43);
      click('Add measurement point');
      await latitude(44);
      click('Add measurement point');
      expect(measure.vertices.map((point) => point.position.latitude)).toEqual([42, 43, 44]);
      const select = target.querySelector('select');
      if (!select) throw new Error('Missing measurement point selector');
      select.value = '1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      flushSync();
      await latitude(43.5);
      click('Move point to coordinates');
      expect(measure.vertices[1].position.latitude).toBe(43.5);
      const deletePoint = target.querySelector<HTMLButtonElement>(
        'button[aria-label="Delete measurement point 2"]',
      );
      if (!deletePoint) throw new Error('Missing selected-point delete action');
      deletePoint.click();
      flushSync();
      expect(measure.vertices).toHaveLength(2);
      click('Undo');
      expect(measure.vertices[1].position.latitude).toBe(43.5);
      click('Undo');
      expect(measure.vertices[1].position.latitude).toBe(43);
    } finally {
      await unmount(component);
      target.remove();
    }
  });
});

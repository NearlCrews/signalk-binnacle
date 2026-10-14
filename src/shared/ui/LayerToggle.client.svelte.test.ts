import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import A11Y_CSS from '../../styles/a11y.css?raw';
import FORMS_CSS from '../../styles/forms.css?raw';
import TOKENS_CSS from '../../styles/tokens.css?raw';
import LayerToggle from './LayerToggle.svelte';

// Browser-only suite: the switch's size, hit area, focus ring, and night colors are laid out and
// computed by a real engine. The markup contract lives in LayerToggle.svelte.test.ts.

let sheet: HTMLStyleElement;
beforeAll(() => {
  sheet = document.createElement('style');
  sheet.textContent = `${TOKENS_CSS}\n${FORMS_CSS}\n${A11Y_CSS}`;
  document.head.append(sheet);
});
afterAll(() => sheet.remove());

const mounted: Array<() => void> = [];
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  document.documentElement.style.fontSize = '';
  delete document.documentElement.dataset.theme;
});

function mountToggle(props: Record<string, unknown>, width = 352) {
  const target = document.createElement('div');
  target.style.cssText = `display: flex; inline-size: ${width}px`;
  document.body.append(target);
  const onToggle = vi.fn();
  const component = mount(LayerToggle, {
    target,
    props: { label: 'Toggle', visible: false, onToggle, ...props },
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  flushSync();
  const input = target.querySelector('input') as HTMLInputElement;
  const label = target.querySelector('label') as HTMLLabelElement;
  return { input, label, onToggle };
}

function blueChannel(color: string): number {
  const channels = color.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
  return channels[2] ?? 0;
}

describe('LayerToggle switch', () => {
  it('keeps the switch full size beside a long name, which ellipsizes', () => {
    const { input, label } = mountToggle({
      label: 'EMODnet bathymetry quality index and survey coverage contours for the North Atlantic',
    });
    expect(input.getBoundingClientRect().width).toBeGreaterThanOrEqual(40);
    const title = label.querySelector('.title') as HTMLElement;
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
  });

  it('toggles from the keyboard and shows the focus ring', () => {
    const { input, onToggle } = mountToggle({});
    input.focus();
    expect(document.activeElement).toBe(input);
    input.click();
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(getComputedStyle(input).outlineStyle).not.toBe('none');
  });

  it('does not toggle while disabled, and dims the control only once', () => {
    const { input, label, onToggle } = mountToggle({ disabled: true });
    input.click();
    expect(onToggle).not.toHaveBeenCalled();
    expect(Number(getComputedStyle(label).opacity)).toBe(1);
    expect(Number(getComputedStyle(input).opacity)).toBeGreaterThan(0.4);
  });

  it('keeps a 44 px row and an unclipped switch at 200 percent text', () => {
    document.documentElement.style.fontSize = '200%';
    const { input, label } = mountToggle({});
    expect(label.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(
      label.getBoundingClientRect().right,
    );
  });

  it('paints no blue in night-red, on or off', () => {
    document.documentElement.dataset.theme = 'night-red';
    for (const visible of [false, true]) {
      const { input } = mountToggle({ visible });
      for (const color of [
        getComputedStyle(input).backgroundColor,
        getComputedStyle(input).borderTopColor,
        getComputedStyle(input, '::before').backgroundColor,
      ]) {
        expect(blueChannel(color)).toBe(0);
      }
    }
  });
});

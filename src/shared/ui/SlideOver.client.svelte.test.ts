import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SlideOverTestHarness from './SlideOverTestHarness.svelte';

const mounted: Array<() => void> = [];

function mountHarness() {
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(SlideOverTestHarness, { target });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  return target;
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('SlideOver focus trap updates', () => {
  it('preserves the panel shell and child-local state when the focus trap changes', () => {
    const target = mountHarness();
    const panel = target.querySelector('aside');
    const input = target.querySelector<HTMLInputElement>('input[aria-label="Panel-local value"]');
    const toggle = target.querySelector<HTMLButtonElement>('button');
    if (!panel || !input || !toggle) throw new Error('missing SlideOver test controls');
    input.value = 'Retained value';

    toggle.click();
    flushSync();

    expect(target.querySelector('aside')).toBe(panel);
    expect(target.querySelector('input')).toBe(input);
    expect(input.value).toBe('Retained value');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
  });
});

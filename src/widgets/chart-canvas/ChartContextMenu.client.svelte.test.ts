import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChartContextMenu from './ChartContextMenu.svelte';

const mounted: Array<() => void> = [];

function mountMenu(): HTMLDivElement {
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(ChartContextMenu, {
      target,
      props: {
        x: 200,
        y: 200,
        width: 800,
        height: 600,
        onGoToHere: vi.fn(),
        onStartRoute: vi.fn(),
        onClose: vi.fn(),
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  return target;
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`missing button: ${label}`);
  return match;
}

function pressTab(from: HTMLElement, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  from.dispatchEvent(event);
  return event;
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('ChartContextMenu go-to confirmation', () => {
  it('keeps Tab inside the confirmation dialog', () => {
    const target = mountMenu();
    button(target, 'Go to here').click();
    flushSync();

    const surface = target.querySelector<HTMLElement>('.chart-context-menu');
    expect(surface?.getAttribute('role')).toBe('dialog');
    expect(surface?.getAttribute('aria-modal')).toBe('true');

    const confirm = button(target, 'Start navigation');
    const cancel = button(target, 'Cancel');
    expect(document.activeElement).toBe(cancel);

    const forward = pressTab(cancel);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);

    const backward = pressTab(confirm, true);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
  });

  it('leaves the action menu untrapped', () => {
    const target = mountMenu();
    const surface = target.querySelector<HTMLElement>('.chart-context-menu');
    expect(surface?.getAttribute('role')).toBe('menu');
    expect(surface?.getAttribute('aria-modal')).toBe(null);

    const first = button(target, 'Go to here');
    expect(document.activeElement).toBe(first);
    expect(pressTab(first).defaultPrevented).toBe(false);
  });
});

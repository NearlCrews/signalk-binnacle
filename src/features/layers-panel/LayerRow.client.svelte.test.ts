import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { LayerListItem } from '$shared/map';
import LayerRow from './LayerRow.svelte';
import type { LayersView } from './layers-view.svelte';

const mounted: Array<() => void> = [];
const noop = (): void => {};
const view = { toggle: noop, setOpacity: noop } as unknown as LayersView;

function mountRow(overrides: Partial<LayerListItem> = {}): HTMLElement {
  const target = document.createElement('div');
  document.body.append(target);
  const item: LayerListItem = {
    id: 'depth',
    title: 'Depth',
    visible: true,
    opacity: 0.85,
    supportsOpacity: true,
    pinned: false,
    band: 'overlay-top',
    available: true,
    ...overrides,
  };
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(LayerRow, {
      target,
      props: {
        item,
        view,
        index: 0,
        count: 1,
        dragging: false,
        dropBefore: false,
        dropAfter: false,
        onHandlePointerDown: noop,
        onHandleKeydown: noop,
      },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  return target;
}

function openOpacity(target: HTMLElement): void {
  const trigger = target.querySelector<HTMLButtonElement>('[aria-label="Adjust Depth opacity"]');
  if (!trigger) throw new Error('no opacity trigger');
  trigger.click();
  flushSync();
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('LayerRow opacity popover', () => {
  it('exposes the popover as a group, not a modal dialog', () => {
    const target = mountRow();
    openOpacity(target);

    const surface = target.querySelector('.anchored-menu-surface');
    expect(surface?.getAttribute('role')).toBe('group');
    expect(surface?.getAttribute('aria-label')).toBe('Depth opacity');
    const trigger = target.querySelector('[aria-label="Adjust Depth opacity"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(trigger?.hasAttribute('aria-haspopup')).toBe(false);
  });

  it('announces the opacity as a percentage rather than a raw fraction', () => {
    const target = mountRow();
    openOpacity(target);

    const slider = target.querySelector('input[type="range"]');
    expect(slider?.getAttribute('aria-valuetext')).toBe('85%');
  });
});

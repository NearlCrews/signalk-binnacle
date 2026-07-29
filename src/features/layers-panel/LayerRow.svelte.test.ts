import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { LayerListItem } from '$shared/map';
import LayerRow, { focusLayerOpacityControl, restoreLayerOpacityFocus } from './LayerRow.svelte';
import type { LayersView } from './layers-view.svelte';

const noop = (): void => {};
const view = { toggle: noop, setOpacity: noop } as unknown as LayersView;

function layer(id: string, overrides: Partial<LayerListItem> = {}): LayerListItem {
  return {
    id,
    title: id,
    visible: true,
    opacity: 1,
    supportsOpacity: true,
    pinned: false,
    band: 'overlay-top',
    available: true,
    ...overrides,
  };
}

function body(item: LayerListItem, subLayers: LayerListItem[], onManage?: () => void): string {
  return render(LayerRow, {
    props: {
      item,
      subLayers,
      groupTitle: 'Facet group',
      view,
      index: 0,
      count: 1,
      dragging: false,
      dropBefore: false,
      dropAfter: false,
      onHandlePointerDown: noop,
      onHandleKeydown: noop,
      onManage,
      manageLabel: onManage ? `Open ${item.title} chart details` : undefined,
    },
  }).body;
}

function checkboxAttributes(html: string): string[] {
  return [...html.matchAll(/<input type="checkbox"([^>]*)\/>/g)].map((match) => match[1] ?? '');
}

describe('LayerRow availability', () => {
  it('disables and explains an unavailable standalone layer', () => {
    const html = body(
      layer('standalone', {
        available: false,
        unavailableHint: 'Standalone provider unavailable.',
      }),
      [],
    );
    const checkboxes = checkboxAttributes(html);

    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0]).toContain('disabled=""');
    expect(checkboxes[0]).toContain('aria-describedby="layer-standalone-unavailable"');
    expect(html).toContain('Standalone provider unavailable.');
  });

  it('keeps unavailable chart details reachable while its toggle stays off', () => {
    const html = body(
      layer('style-chart', {
        title: 'Provider style',
        visible: false,
        supportsOpacity: false,
        available: false,
        unavailableHint: 'Style-document charts are unsupported.',
      }),
      [],
      noop,
    );
    const checkboxes = checkboxAttributes(html);

    expect(checkboxes).toHaveLength(1);
    expect(checkboxes[0]).toContain('disabled=""');
    expect(checkboxes[0]).not.toContain('checked=""');
    expect(html).toContain('aria-label="Open Provider style chart details"');
  });

  it('disables an unavailable facet parent and every child beneath it', () => {
    const html = body(
      layer('parent-facet', {
        title: 'Parent facet',
        available: false,
        unavailableHint: 'Provider unavailable.',
      }),
      [layer('available-child', { title: 'Available child' })],
    );
    const checkboxes = checkboxAttributes(html);

    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toContain('disabled=""');
    expect(checkboxes[0]).toContain('aria-describedby="layer-parent-facet-unavailable"');
    expect(checkboxes[1]).toContain('disabled=""');
    expect(checkboxes[1]).toContain('aria-describedby="layer-parent-facet-unavailable"');
    expect(html).toContain('Provider unavailable.');
  });

  it('disables and explains an unavailable child without disabling its available parent', () => {
    const html = body(layer('parent-facet', { title: 'Parent facet' }), [
      layer('unavailable-child', {
        title: 'Unavailable child',
        available: false,
        unavailableHint: 'Child provider unavailable.',
      }),
    ]);
    const checkboxes = checkboxAttributes(html);

    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).not.toContain('disabled=""');
    expect(checkboxes[1]).toContain('disabled=""');
    expect(checkboxes[1]).toContain('aria-describedby="layer-unavailable-child-unavailable"');
    expect(html).toContain('Child provider unavailable.');
  });
});

describe('LayerRow opacity focus', () => {
  it('moves focus into the opacity control', () => {
    const control = { focus: vi.fn() } as unknown as HTMLElement;

    focusLayerOpacityControl(control);

    expect(control.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('restores the trigger when the popup control is removed', () => {
    const trigger = { focus: vi.fn(), isConnected: true } as unknown as HTMLElement;
    const removedControl = { isConnected: false } as unknown as Element;

    restoreLayerOpacityFocus(trigger, removedControl, {} as HTMLElement);

    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

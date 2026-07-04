import type { LayerListItem } from '$shared/map';
import { createReorder, type Reorder } from '$shared/ui';
import { clampReorderSlot } from './layer-category';
import type { LayersView } from './layers-view.svelte';

export type LayerReorder = Reorder;

export function createLayerReorder(
  getView: () => LayersView,
  getMovable: () => LayerListItem[],
  getListEl: () => HTMLUListElement | undefined,
): LayerReorder {
  const view = getView();
  return createReorder({
    getItems: getMovable,
    getListEl,
    commit: (id, slot) => view.reorder(id, slot),
    // The clamp reads category off LayerListItem, so it receives the original items by closure.
    clampSlot: (_items, id, slot) => clampReorderSlot(getMovable(), id, slot),
    rowAttribute: 'data-layer-row',
    handleSelector: '.handle',
    itemNoun: 'Layer',
  });
}

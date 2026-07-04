export interface ReorderItem {
  id: string;
  title: string;
}

export interface ReorderOptions {
  getItems: () => ReorderItem[];
  getListEl: () => HTMLElement | undefined;
  commit: (id: string, slot: number) => void;
  // Optional slot clamp (the layers category constraint); identity when absent.
  clampSlot?: (items: ReorderItem[], id: string, slot: number) => number;
  // DOM contract, parameterized: the row data attribute and the focusable handle selector.
  rowAttribute: string; // e.g. 'data-layer-row' or 'data-tile-row'
  handleSelector: string; // e.g. '.handle'
  itemNoun: string; // 'Layer' or 'Tile', for the polite announcement fallback
}

export interface Reorder {
  // The id being dragged, so a row can render its dragging state.
  readonly dragId: string | null;
  // Announced politely after a keyboard reorder, so a screen-reader user hears the new z-order.
  readonly reorderAnnouncement: string;
  // Which edge, if any, a row should draw the drop indicator on.
  indicatorFor(id: string): { before: boolean; after: boolean };
  handlePointerDown(id: string, event: PointerEvent): void;
  handleKeydown(id: string, event: KeyboardEvent): void;
}

// The imperative pointer-and-keyboard drag-reorder controller. It owns the drag state and the
// window listeners, addressing rows by their index in the movable list, and commits a drop through
// options.commit. getItems and getListEl are getters so the controller always reads the caller's
// current list and list element rather than capturing stale refs, and so the movable list has a
// single owner that cannot drift from the controller's copy.
export function createReorder(options: ReorderOptions): Reorder {
  // The movable rows: read through the caller's getter so there is one owner of the list and the
  // controller cannot drift from it.
  const movable = $derived(options.getItems());

  // The non-pinned id being dragged, and the insertion slot it would land in. The slot is an
  // index in the movable list with the dragged row removed, matching commit's contract.
  let dragId = $state<string | null>(null);
  let dropSlot = $state<number | null>(null);

  // The movable rows minus the one being dragged, computed once per drag frame rather than
  // re-filtered for every row inside indicatorFor.
  const remaining = $derived(
    dragId === null ? movable : movable.filter((item) => item.id !== dragId),
  );

  // Announced politely after a keyboard reorder, so a screen-reader user hears the new z-order rather
  // than only the refocused handle re-reading its label.
  let reorderAnnouncement = $state('');

  const clamp = options.clampSlot ?? ((_items: ReorderItem[], _id: string, s: number) => s);

  function movableIndex(id: string): number {
    return movable.findIndex((item) => item.id === id);
  }

  // Translate an insertion slot (movable list, dragged row removed) into the id of the row it
  // renders against, plus which edge, so a row can draw the drop indicator.
  function indicatorFor(id: string): { before: boolean; after: boolean } {
    if (dragId === null || dropSlot === null || id === dragId) {
      return { before: false, after: false };
    }
    const rowIndex = remaining.findIndex((item) => item.id === id);
    if (rowIndex < 0) return { before: false, after: false };
    if (dropSlot === remaining.length) {
      return { before: false, after: rowIndex === remaining.length - 1 };
    }
    return { before: rowIndex === dropSlot, after: false };
  }

  function handlePointerDown(id: string, event: PointerEvent): void {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    dragId = id;
    dropSlot = movableIndex(id);
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);

    // Resolve the list element once for this drag: both the initial measurement and the scroll
    // listener close over the same ref rather than reading the getter twice.
    const listEl = options.getListEl();

    // Measure each non-dragged row's vertical midpoint once at drag start, re-measuring only when
    // the list scrolls mid-drag, so a pointermove costs no layout read or reflow. Collapsed-category
    // rows stay in the DOM (hidden), so they measure as a zero midpoint and never become a drop
    // target, while still holding their movable index, so the slot the pointer resolves to is a
    // valid movable index.
    const measureMidpoints = (): number[] =>
      listEl
        ? [...listEl.querySelectorAll<HTMLElement>(`[${options.rowAttribute}]`)]
            .filter((el) => el.getAttribute(options.rowAttribute) !== id)
            .map((el) => {
              const rect = el.getBoundingClientRect();
              return rect.top + rect.height / 2;
            })
        : [];
    let midpoints = measureMidpoints();

    // The slot is the first midpoint the pointer is above, matching commit's contract, then
    // clamped to the row's own category span so the drop indicator never points outside the visible
    // category (commit clamps again as the unforgeable backstop).
    const slotFromPointer = (clientY: number): number => {
      let slot = midpoints.length;
      for (let i = 0; i < midpoints.length; i++) {
        if (clientY < midpoints[i]) {
          slot = i;
          break;
        }
      }
      return clamp(movable, id, slot);
    };

    // One AbortController tears down all the listeners on drop or cancel, so the teardown
    // lives in a single place rather than being repeated per handler.
    const drag = new AbortController();
    const { signal } = drag;
    listEl?.addEventListener(
      'scroll',
      () => {
        midpoints = measureMidpoints();
      },
      { signal, passive: true },
    );
    const finish = (doCommit: boolean): void => {
      drag.abort();
      handle.releasePointerCapture(event.pointerId);
      if (doCommit && dragId !== null && dropSlot !== null) options.commit(dragId, dropSlot);
      dragId = null;
      dropSlot = null;
    };
    handle.addEventListener(
      'pointermove',
      (move) => {
        dropSlot = slotFromPointer(move.clientY);
      },
      { signal },
    );
    handle.addEventListener('pointerup', () => finish(true), { signal });
    handle.addEventListener('pointercancel', () => finish(false), { signal });
  }

  function handleKeydown(id: string, event: KeyboardEvent): void {
    const from = movableIndex(id);
    if (from < 0) return;
    let to = from;
    if (event.key === 'ArrowUp') to = from - 1;
    else if (event.key === 'ArrowDown') to = from + 1;
    else return;
    event.preventDefault();
    if (to < 0 || to >= movable.length) return;
    // Hold the move inside the row's own category: a clamp back to the current slot means the row
    // is already at its bucket edge, so there is nothing to move or announce.
    to = clamp(movable, id, to);
    if (to === from) return;
    const title = movable[from]?.title ?? options.itemNoun;
    options.commit(id, to);
    reorderAnnouncement = `Moved ${title} to position ${to + 1} of ${movable.length}.`;
    // Keep focus on the moved handle as it follows the row to its new position.
    requestAnimationFrame(() => {
      const moved = options
        .getListEl()
        ?.querySelector<HTMLElement>(
          `[${options.rowAttribute}="${CSS.escape(id)}"] ${options.handleSelector}`,
        );
      moved?.focus();
    });
  }

  return {
    get dragId() {
      return dragId;
    },
    get reorderAnnouncement() {
      return reorderAnnouncement;
    },
    indicatorFor,
    handlePointerDown,
    handleKeydown,
  };
}

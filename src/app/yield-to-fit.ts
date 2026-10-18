// Keeps a row of chips whole: when the row's natural width outgrows its box, chips give way in rank
// order (the item's data-yield, highest first) until the rest fit, rather than squeezing or spilling
// over a neighbor (the top bar's chips over MOB). An item without a rank never yields. Every pass
// shows and measures every item again, so a chip that gave way returns as soon as there is room.
// Items are display: contents wrappers, so an item's width is its children's. Layout is read in an
// animation frame, outside ResizeObserver delivery, as spanColumns does.
export function yieldToFit(node: HTMLElement) {
  let frame: number | undefined;

  const measure = (): void => {
    frame = undefined;
    const items = [...node.children].filter((item) => item instanceof HTMLElement);
    for (const item of items) item.classList.remove('is-yielded');
    const chips = items.map((item) => ({
      rank: Number(item.dataset.yield ?? 0),
      width: [...item.children].reduce(
        (sum, child) => sum + child.getBoundingClientRect().width,
        0,
      ),
    }));
    const gap = Number.parseFloat(getComputedStyle(node).columnGap) || 0;
    for (const index of yieldedIndexes(chips, gap, node.clientWidth)) {
      items[index]?.classList.add('is-yielded');
    }
  };
  const schedule = (): void => {
    if (frame === undefined) frame = requestAnimationFrame(measure);
  };

  // Fit at once on insert, so a chip never overlaps its neighbor for a frame. The mutation observer
  // catches a chip arriving or leaving and a label changing (a countdown, a profile name); the
  // class toggles here are attribute changes, which it does not watch.
  measure();
  const resize = new ResizeObserver(schedule);
  resize.observe(node);
  const mutation = new MutationObserver(schedule);
  mutation.observe(node, { childList: true, subtree: true, characterData: true });
  void document.fonts?.ready.then(schedule);

  return {
    destroy(): void {
      resize.disconnect();
      mutation.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    },
  };
}

// The indexes that give way, highest rank first, until the shown chips and the gaps between them
// fit. A chip with no width (absent or hidden by a breakpoint) takes no gap and never needs to yield.
// The half-pixel tolerance keeps a rounding hair from costing a chip.
export function yieldedIndexes(
  chips: readonly { rank: number; width: number }[],
  gap: number,
  available: number,
): number[] {
  const shown = chips.map((chip, index) => ({ ...chip, index })).filter((chip) => chip.width > 0);
  let total =
    shown.reduce((sum, chip) => sum + chip.width, 0) + gap * Math.max(0, shown.length - 1);
  const yielded: number[] = [];
  for (const chip of shown.filter((c) => c.rank > 0).sort((a, b) => b.rank - a.rank)) {
    if (total <= available + 0.5) break;
    total -= chip.width + gap;
    yielded.push(chip.index);
  }
  return yielded;
}

// Snaps a grid item to whole columns of its grid: the item spans as many of the parent's equal
// column tracks as its content needs, so a run of variable-width items (the status strip's caution
// line) starts and ends on the same column edges as the readout cells below it. The item's first
// child is its content, sized to max-content. Layout is read in an animation frame, outside
// ResizeObserver delivery, as observeClientHeight does.
export function spanColumns(node: HTMLElement) {
  const grid = node.parentElement;
  const content = node.firstElementChild;
  if (!grid || !(content instanceof HTMLElement)) return {};
  let frame: number | undefined;

  const measure = (): void => {
    frame = undefined;
    const tracks = getComputedStyle(grid)
      .gridTemplateColumns.split(' ')
      .map(Number.parseFloat)
      .filter((width) => width > 0);
    const track = tracks[0];
    if (track === undefined) return;
    const style = getComputedStyle(node);
    const needed =
      content.offsetWidth +
      Number.parseFloat(style.paddingInlineStart) +
      Number.parseFloat(style.paddingInlineEnd);
    node.style.gridColumn = `span ${columnSpan(needed, track, tracks.length)}`;
  };
  const schedule = (): void => {
    if (frame === undefined) frame = requestAnimationFrame(measure);
  };

  // Span at once on insert, so a notice never overlaps its neighbors for a frame, and on a hidden
  // tab, where animation frames wait until the tab is shown again.
  measure();
  const observer = new ResizeObserver(schedule);
  observer.observe(grid);
  observer.observe(content);

  return {
    destroy(): void {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    },
  };
}

// Whole tracks for a width, never fewer than one or more than the grid has. The half-pixel
// tolerance keeps a width that rounds a hair past a track edge from claiming a whole extra column.
export function columnSpan(needed: number, track: number, count: number): number {
  if (!(track > 0) || !(count > 0)) return 1;
  return Math.min(count, Math.max(1, Math.ceil((needed - 0.5) / track)));
}

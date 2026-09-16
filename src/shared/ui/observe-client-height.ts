// Read layout outside ResizeObserver delivery: a newly mounted panel can still need layout,
// and reading clientHeight inside the callback can create another undelivered notification.
export function observeClientHeight(node: HTMLElement, onHeight: (height: number) => void) {
  let frame: number | undefined;
  let lastHeight: number | undefined;
  let disposed = false;

  const schedule = (): void => {
    if (disposed || frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (disposed) return;
      const height = node.clientHeight;
      if (height === lastHeight) return;
      lastHeight = height;
      onHeight(height);
    });
  };

  const observer = new ResizeObserver(schedule);
  observer.observe(node, { box: 'border-box' });
  schedule();

  return {
    update(next: (height: number) => void): void {
      onHeight = next;
      lastHeight = undefined;
      schedule();
    },
    destroy(): void {
      disposed = true;
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    },
  };
}

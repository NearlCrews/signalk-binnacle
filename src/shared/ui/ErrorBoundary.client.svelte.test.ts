import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ErrorBoundaryTestHarness from './ErrorBoundaryTestHarness.svelte';

const mounted: Array<() => void> = [];

function mountHarness(initiallyFailing: boolean) {
  const target = document.createElement('div');
  document.body.append(target);
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(ErrorBoundaryTestHarness, {
      target,
      props: { initiallyFailing },
    });
  });
  mounted.push(() => {
    void unmount(component);
    target.remove();
  });
  const button = (label: string): HTMLButtonElement => {
    const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!found) throw new Error(`no button labeled ${label}`);
    return found;
  };
  return { target, button };
}

afterEach(() => {
  for (const dispose of mounted.splice(0).reverse()) dispose();
});

describe('ErrorBoundary', () => {
  it('recovers from a failure during the initial render', () => {
    const harness = mountHarness(true);
    expect(harness.target.querySelector('[role="alert"]')?.textContent).toBe('render failed');

    harness.button('Retry render').click();
    flushSync();
    expect(harness.target.textContent).toContain('Content ready');
  });

  it('recovers from a reactive render failure after mounting', () => {
    const harness = mountHarness(false);
    expect(harness.target.textContent).toContain('Content ready');

    harness.button('Trigger failure').click();
    flushSync();
    expect(harness.target.querySelector('[role="alert"]')?.textContent).toBe('render failed');

    harness.button('Retry render').click();
    flushSync();
    expect(harness.target.textContent).toContain('Content ready');
  });
});

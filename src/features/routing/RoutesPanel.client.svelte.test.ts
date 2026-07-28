import { type ComponentProps, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '$entities/route';
import { PersistedValue } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import RoutesPanel from './RoutesPanel.svelte';

const route: Route = {
  id: 'r1',
  name: 'Passage',
  waypoints: [
    { position: { latitude: 42, longitude: -83 } },
    { position: { latitude: 43, longitude: -82 } },
  ],
};

// A second, inactive route, so a test can open a confirm on one card and act on the other.
const spare: Route = { ...route, id: 'r2', name: 'Return' };

const mounted: Array<() => void> = [];

function mountPanel() {
  const onStop = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  // A state proxy, so a test can change a prop after mount the way the composition root does.
  const props = $state<ComponentProps<typeof RoutesPanel>>({
    auth: { writeBlocked: false } as AuthController,
    routes: [route, spare],
    shownIds: new Set<string>(),
    working: undefined,
    activeId: route.id,
    refreshing: false,
    loadState: 'ready',
    busy: false,
    highlight: undefined,
    onHighlightLeg: vi.fn(),
    error: undefined,
    editorLoadFailed: false,
    onRetryEditor: vi.fn(),
    onRetry: vi.fn(),
    onNew: vi.fn(),
    onEditRoute: vi.fn(),
    onSave: vi.fn(),
    onCancelEdit: vi.fn(),
    onToggleShown: vi.fn(),
    onLocate: vi.fn(),
    onActivate: vi.fn(),
    onStop,
    onReverse: vi.fn(),
    onExportGpx: vi.fn(),
    onImportGpx: vi.fn(),
    planningSpeed: new PersistedValue('binnacle:route-speed-test', 5, {
      getItem: () => null,
      setItem: () => {},
    }),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  });
  let component!: ReturnType<typeof mount>;
  flushSync(() => {
    component = mount(RoutesPanel, { target, props });
  });
  mounted.push(() => {
    // Teardown is synchronous without outro transitions; the returned promise only awaits those.
    void unmount(component);
    target.remove();
  });
  const byText = (text: string): HTMLButtonElement | undefined =>
    [...target.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === text,
    );
  const clickLabel = (label: string): void => {
    const button = target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!button) throw new Error(`no control labeled ${label}`);
    button.click();
    flushSync();
  };
  return {
    onStop,
    props,
    clickLabel,
    question: () => target.querySelector('[role="group"] .confirm-text')?.textContent?.trim(),
    questions: () =>
      [...target.querySelectorAll('[role="group"] .confirm-text')].map((node) =>
        node.textContent?.trim(),
      ),
    armStop: () => clickLabel('Stop navigation'),
    click: (text: string) => {
      const button = byText(text);
      if (!button) throw new Error(`no button labeled ${text}`);
      button.click();
      flushSync();
    },
    hasStopControl: () =>
      target.querySelector('button[aria-label="Stop navigation"]') !== null ||
      byText('Stop navigation') !== undefined,
  };
}

afterEach(() => {
  for (const remove of mounted.splice(0).reverse()) remove();
});

describe('RoutesPanel stop', () => {
  it('asks before stopping navigation and names the route', () => {
    const panel = mountPanel();
    panel.armStop();
    expect(panel.onStop).not.toHaveBeenCalled();
    expect(panel.question()).toBe('Stop navigating Passage?');
  });

  it('stops navigation only on the confirming tap', () => {
    const panel = mountPanel();
    panel.armStop();
    panel.click('Stop navigation');
    expect(panel.onStop).toHaveBeenCalledTimes(1);
    expect(panel.question()).toBeUndefined();
  });

  it('keeps one card confirmation open at a time', () => {
    const panel = mountPanel();
    panel.armStop();
    panel.clickLabel('Start navigation on route');
    expect(panel.questions()).toEqual([
      'Start navigation on Return? Check the route before relying on it.',
    ]);

    panel.armStop();
    expect(panel.questions()).toEqual(['Stop navigating Passage?']);
  });

  it('drops the question when navigation stops from somewhere else', () => {
    const panel = mountPanel();
    panel.armStop();
    expect(panel.question()).toBe('Stop navigating Passage?');

    panel.props.activeId = undefined;
    flushSync();

    expect(panel.question()).toBeUndefined();
    expect(panel.onStop).not.toHaveBeenCalled();
  });

  it('keeps navigating when the confirmation is canceled', () => {
    const panel = mountPanel();
    panel.armStop();
    panel.click('Cancel');
    expect(panel.onStop).not.toHaveBeenCalled();
    expect(panel.question()).toBeUndefined();
    expect(panel.hasStopControl()).toBe(true);
  });
});

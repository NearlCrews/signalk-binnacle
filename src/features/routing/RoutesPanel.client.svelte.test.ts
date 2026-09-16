import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte';
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

function mountPanel(overrides: Partial<ComponentProps<typeof RoutesPanel>> = {}) {
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
    ...overrides,
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
    target,
    clickLabel,
    nameForm: () => target.querySelector<HTMLFormElement>('form.name-entry'),
    submitNameForm: () => {
      const form = target.querySelector<HTMLFormElement>('form.name-entry');
      if (!form) throw new Error('no name form open');
      form.requestSubmit();
      flushSync();
    },
    openMenu: (name: string) => clickLabel(`More actions for ${name}`),
    question: () => target.querySelector('[role="group"] .confirm-text')?.textContent?.trim(),
    questions: () =>
      [...target.querySelectorAll('[role="group"] .confirm-text')].map((node) =>
        node.textContent?.trim(),
      ),
    armStop: () => clickLabel('Stop navigation'),
    cancelConfirmation: () => {
      const cancel = target.querySelector<HTMLButtonElement>('.confirm button:not(.btn-danger)');
      if (!cancel) throw new Error('no confirmation open');
      cancel.click();
      flushSync();
    },
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

describe('RoutesPanel confirmations', () => {
  it('expands a minimized draft before asking to discard it on close', () => {
    const onClose = vi.fn();
    const panel = mountPanel({ working: route, onClose });
    // Editing starts collapsed at phone widths and expanded at wider client-test viewports.
    if (panel.target.querySelector('button[aria-label="Expand panel"]'))
      panel.clickLabel('Expand panel');
    panel.clickLabel('Minimize panel');
    expect(panel.target.querySelector('button[aria-label="Expand panel"]')).not.toBeNull();
    panel.clickLabel('Close routes panel');
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.target.querySelector('button[aria-label="Minimize panel"]')).not.toBeNull();
    expect(panel.question()).toContain('Discard');
  });

  it('cancels an armed delete when another row asks about navigation', () => {
    const panel = mountPanel();
    panel.openMenu('Passage');
    panel.click('Delete route');
    expect(panel.questions()).toEqual(['Delete this route and stop navigating?']);

    panel.clickLabel('Start navigation on route');

    expect(panel.questions()).toEqual([
      'Start navigation on Return? Check the route before relying on it.',
    ]);
  });

  it('cancels a navigation question when a delete is armed elsewhere', () => {
    const panel = mountPanel();
    panel.clickLabel('Start navigation on route');
    panel.openMenu('Passage');
    panel.click('Delete route');

    expect(panel.questions()).toEqual(['Delete this route and stop navigating?']);
  });
});

describe('RoutesPanel naming', () => {
  it('keeps the name form and its entered name when the save is refused', async () => {
    const onSave = vi.fn(async () => false);
    const panel = mountPanel({ working: route, onSave });
    panel.click('Save');
    expect(panel.nameForm()).not.toBeNull();

    panel.submitNameForm();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    flushSync();

    expect(panel.nameForm()).not.toBeNull();
  });

  it('closes the name form once the save is accepted', async () => {
    const onSave = vi.fn(async () => true);
    const panel = mountPanel({ working: route, onSave });
    panel.click('Save');
    panel.submitNameForm();
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    flushSync();

    expect(panel.nameForm()).toBeNull();
  });
});

describe('RoutesPanel cancellation focus', () => {
  it('returns canceled draft naming to the recreated Save control', async () => {
    const panel = mountPanel({ working: route });
    panel.click('Save');
    expect(document.activeElement).toBe(panel.nameForm()?.querySelector('input'));
    panel.click('Cancel');
    await tick();

    expect(panel.nameForm()).toBeNull();
    expect(document.activeElement?.textContent?.trim()).toBe('Save');
    expect(panel.props.onSave).not.toHaveBeenCalled();
  });

  it('returns Escape from saved-route naming to that route’s recreated More control', async () => {
    const panel = mountPanel({ onRename: vi.fn(async () => true) });
    panel.openMenu('Passage');
    panel.click('Rename route');
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    flushSync();
    await tick();

    expect(panel.nameForm()).toBeNull();
    expect(document.activeElement).toBe(
      panel.target.querySelector('button[aria-label="More actions for Passage"]'),
    );
    expect(panel.props.onRename).not.toHaveBeenCalled();
    expect(panel.props.onClose).not.toHaveBeenCalled();
  });

  it.each(['start', 'stop', 'delete'] as const)(
    'returns canceled %s to the corresponding saved-route action',
    async (action) => {
      const panel = mountPanel();
      if (action === 'start') panel.clickLabel('Start navigation on route');
      else if (action === 'stop') panel.armStop();
      else {
        panel.openMenu('Passage');
        panel.click('Delete route');
      }
      panel.cancelConfirmation();
      await tick();

      const label =
        action === 'start'
          ? 'Start navigation on route'
          : action === 'stop'
            ? 'Stop navigation'
            : 'More actions for Passage';
      expect(document.activeElement).toBe(
        panel.target.querySelector(`button[aria-label="${label}"]`),
      );
      expect(panel.questions()).toEqual([]);
      expect(panel.props.onActivate).not.toHaveBeenCalled();
      expect(panel.props.onStop).not.toHaveBeenCalled();
      expect(panel.props.onDelete).not.toHaveBeenCalled();
    },
  );

  it.each(['Close routes panel', 'Back to menu'])(
    'returns canceled draft discard to its %s opener',
    async (label) => {
      const panel = mountPanel({ working: route, onBack: vi.fn() });
      panel.clickLabel(label);
      panel.cancelConfirmation();
      await tick();

      expect(document.activeElement).toBe(
        panel.target.querySelector(`button[aria-label="${label}"]`),
      );
      expect(panel.props.onCancelEdit).not.toHaveBeenCalled();
      expect(panel.props.onClose).not.toHaveBeenCalled();
      expect(panel.props.onBack).not.toHaveBeenCalled();
    },
  );

  it('returns canceled draft discard to the editor Cancel control', async () => {
    const panel = mountPanel({ working: route });
    panel.click('Cancel');
    panel.cancelConfirmation();
    await tick();

    expect(panel.question()).toBeUndefined();
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
    expect(panel.props.onCancelEdit).not.toHaveBeenCalled();
  });

  it('does not steal focus when another live control gains it before cancellation settles', async () => {
    const panel = mountPanel({ working: route });
    panel.click('Save');
    panel.click('Cancel');
    const close = panel.target.querySelector<HTMLButtonElement>(
      'button[aria-label="Close routes panel"]',
    );
    close?.focus();
    await tick();

    expect(document.activeElement).toBe(close);
  });

  it('does not restore a saved-card trigger after confirmed navigation', async () => {
    const panel = mountPanel();
    const destination = panel.target.querySelector<HTMLButtonElement>(
      'button[aria-label="Close routes panel"]',
    );
    panel.props.onActivate = vi.fn(() => destination?.focus());
    flushSync();
    panel.clickLabel('Start navigation on route');
    panel.click('Start navigation');
    await tick();

    expect(panel.props.onActivate).toHaveBeenCalledWith(spare.id);
    expect(document.activeElement).toBe(destination);
  });
});

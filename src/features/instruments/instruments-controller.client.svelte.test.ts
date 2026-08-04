import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryProviders } from '$shared/signalk';
import { jsonResponse } from '$shared/testing';
import { flushPromises, makeDeps, mustTile } from './controller-test-helpers';
import { createInstrumentsController, type InstrumentsDeps } from './instruments-controller.svelte';

afterEach(() => vi.unstubAllGlobals());

describe('createInstrumentsController label reactivity', () => {
  it('wakes a reactive reader when the display name arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('belowKeel')
          ? jsonResponse(200, { displayName: 'Sounder' })
          : jsonResponse(404, {}),
      ),
    );
    const deps = makeDeps({ tiles: ['depth'] });
    const depthDef = mustTile('depth');
    let controller!: ReturnType<typeof createInstrumentsController>;
    let label!: () => string;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
      const current = $derived(controller.resolvedLabel(depthDef));
      label = () => current;
    });

    expect(label()).toBe(depthDef.label);
    controller.setOpen(true);
    await flushPromises();
    // The meta cache is a plain Map, so only the version counter can wake a reactive reader.
    expect(label()).toBe('Sounder');

    controller.dispose();
    disposeRoot();
  });
});

describe('createInstrumentsController history provider probe', () => {
  type ProbeState = ReturnType<InstrumentsDeps['getHistoryProviderState']>;

  function countingFetch() {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return url.includes('/history/paths') ? jsonResponse(200, []) : jsonResponse(404, {});
      }),
    );
    return {
      live: () => calls.filter((url) => url.includes('electrical/batteries')).length,
      historyScans: () => calls.filter((url) => url.includes('/history/paths')).length,
    };
  }

  function probeDeps() {
    let state = $state<ProbeState>('checking');
    let providers = $state<HistoryProviders | undefined>(undefined);
    return {
      deps: {
        ...makeDeps(),
        getHistoryProviders: () => providers,
        getHistoryProviderState: () => state,
      },
      settle(next: ProbeState, ids?: readonly string[]) {
        providers = ids ? { ids } : undefined;
        state = next;
      },
    };
  }

  it('still runs a live rescan while the history probe is checking', async () => {
    const fetches = countingFetch();
    const { deps } = probeDeps();
    let controller!: ReturnType<typeof createInstrumentsController>;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
    });

    controller.setOpen(true);
    await flushPromises();
    const before = fetches.live();
    expect(controller.historyStatus).toBe('checking');

    controller.refreshCatalog();
    await flushPromises();

    expect(fetches.live()).toBe(before + 1);

    controller.dispose();
    disposeRoot();
  });

  it('runs the armed history scan when the probe settles, with no second Rescan', async () => {
    const fetches = countingFetch();
    const { deps, settle } = probeDeps();
    let controller!: ReturnType<typeof createInstrumentsController>;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
    });

    controller.setOpen(true);
    await flushPromises();
    expect(fetches.historyScans()).toBe(0);

    settle('available', ['questdb']);
    flushSync();
    await flushPromises();

    expect(fetches.historyScans()).toBeGreaterThan(0);
    expect(controller.historyStatus).not.toBe('checking');

    controller.dispose();
    disposeRoot();
  });

  it('leaves the checking state behind when the probe settles with no provider', async () => {
    countingFetch();
    const { deps, settle } = probeDeps();
    let controller!: ReturnType<typeof createInstrumentsController>;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
    });

    controller.setOpen(true);
    await flushPromises();

    settle('absent');
    flushSync();
    await flushPromises();

    expect(controller.historyStatus).toBe('unavailable');

    controller.dispose();
    disposeRoot();
  });

  it('stops watching the probe once disposed', async () => {
    const fetches = countingFetch();
    const { deps, settle } = probeDeps();
    let controller!: ReturnType<typeof createInstrumentsController>;
    const disposeRoot = $effect.root(() => {
      controller = createInstrumentsController(deps);
    });

    controller.setOpen(true);
    await flushPromises();
    controller.dispose();

    settle('available', ['questdb']);
    flushSync();
    await flushPromises();

    expect(fetches.historyScans()).toBe(0);

    disposeRoot();
  });
});

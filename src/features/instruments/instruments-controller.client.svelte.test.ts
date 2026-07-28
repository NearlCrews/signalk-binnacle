import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from '$shared/testing';
import { flushPromises, makeDeps, mustTile } from './controller-test-helpers';
import { createInstrumentsController } from './instruments-controller.svelte';

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

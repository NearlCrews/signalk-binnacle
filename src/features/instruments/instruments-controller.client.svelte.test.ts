import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersistedValue } from '$shared/settings';
import { SignalKStore } from '$shared/signalk';
import { createFakeStorage, jsonResponse } from '$shared/testing';
import { createInstrumentsController } from './instruments-controller.svelte';
import { DEFAULT_TILES, tileById } from './tile-catalog';

// fetchPathMeta has several await hops before the cache is written.
const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));

function mustTile(id: string) {
  const def = tileById(id);
  if (!def) throw new Error(`Unknown tile id: ${id}`);
  return def;
}

function makeDeps(tiles: string[] = [...DEFAULT_TILES]) {
  return {
    store: new SignalKStore(),
    origin: 'http://sk',
    getToken: (): string | undefined => undefined,
    getHistoryProviders: () => undefined,
    getHistoryProviderState: () => 'absent' as const,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    tilesStore: new PersistedValue<string[]>(
      'binnacle:instrument-tiles-test',
      tiles,
      createFakeStorage(),
    ),
    openStore: new PersistedValue<boolean>(
      'binnacle:instruments-open-test',
      false,
      createFakeStorage(),
    ),
  };
}

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
    const deps = makeDeps(['depth']);
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

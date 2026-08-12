import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalNotesStore } from '$entities/poi';
import { SymbolsStore, symbolIconId } from '$entities/symbols';
import { iconOffsetExpression, type OverlayContext } from '$shared/map';
import type { SkSymbol } from '$shared/signalk';
import { createExpiringStore } from '$shared/storage';
import { createFakeMap, fakeOverlayContext } from '$shared/testing';
import { fetchNotes, type NotePoint } from './notes-client';
import { createNotesOverlay } from './notes-overlay';

vi.mock('./notes-client', () => ({ fetchNotes: vi.fn(), MAX_NOTES_PER_VIEW: 5_000 }));
const fetchNotesMock = vi.mocked(fetchNotes);

// The viewport stub sync reads: a 2 by 2 degree view around a mutable center, so a test pans the
// map by mutating the state object.
function viewport(state: { zoom: number; lng: number; lat: number }) {
  return {
    getZoom: () => state.zoom,
    getCenter: () => ({ lng: state.lng, lat: state.lat }),
    getBounds: () => ({
      getWest: () => state.lng - 1,
      getSouth: () => state.lat - 1,
      getEast: () => state.lng + 1,
      getNorth: () => state.lat + 1,
    }),
  };
}

// A minimal viewport-only ctx for sync tests.
function viewCtx(state: { zoom: number; lng: number; lat: number }): OverlayContext {
  const map = {
    ...viewport(state),
    getSource: () => undefined,
    getLayer: () => undefined,
  };
  return fakeOverlayContext(map);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

// A fake map that renders sources and images (createFakeMap) and also answers the viewport
// calls sync makes, so a symbols test can drive the full fetch-render-register flow.
function viewFakeMap(state: { zoom: number; lng: number; lat: number }) {
  return {
    ...createFakeMap(),
    ...viewport(state),
  };
}

const MARINA_NOTE: NotePoint = {
  id: 'n1',
  name: 'Harbor Marina',
  position: { latitude: 0, longitude: 0 },
  category: 'marina',
  skIcon: 'custom:marina',
};

function marinaSymbol(): SkSymbol {
  return {
    uuid: 'u9',
    aliases: ['custom:marina'],
    name: 'Marina',
    url: '/s/u9.svg',
    roles: ['note'],
    anchor: [12, 24],
  };
}

function storeWith(symbol: SkSymbol, rasterize: SymbolsStore['rasterize']): SymbolsStore {
  return new SymbolsStore('http://pi', undefined, [symbol], rasterize);
}

beforeEach(() => {
  fetchNotesMock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe('notes overlay', () => {
  it('adds the cluster ring, icon, count, point, and selection layers in the routes band', async () => {
    const overlay = createNotesOverlay('http://pi', () => undefined);
    const map = createFakeMap();
    await overlay.add(fakeOverlayContext(map));
    expect(overlay.band).toBe('routes');
    expect(overlay.title).toBe('Places');
    // The note source (clustered) plus the selection-ring source.
    expect(map.sources.size).toBe(2);
    expect(map.layers.has('binnacle-notes-symbol')).toBe(true);
    expect(map.layers.has('binnacle-notes-cluster-ring')).toBe(true);
    expect(map.layers.has('binnacle-notes-cluster-icon')).toBe(true);
    expect(map.layers.has('binnacle-notes-cluster-count')).toBe(true);
    expect(map.layers.has('binnacle-notes-selected')).toBe(true);
    expect(map.layers.has('binnacle-notes-selected-casing')).toBe(true);
  });

  it('blocks marker selection and cluster zoom while another chart tool owns taps', async () => {
    const onSelect = vi.fn();
    const map = { ...createFakeMap(), easeTo: vi.fn() };
    const overlay = createNotesOverlay('http://pi', () => undefined, onSelect, undefined, {
      interactionsAllowed: () => false,
    });
    await overlay.add(fakeOverlayContext(map));
    map.getCanvas().style.cursor = 'crosshair';

    map.emitLayer('mouseenter', 'binnacle-notes-symbol', {});
    map.emitLayer('click', 'binnacle-notes-symbol', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [-83, 42] },
          properties: { id: 'n1', name: 'Marina', category: 'marina' },
        },
      ],
    });
    map.emitLayer('click', 'binnacle-notes-cluster-ring', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [-83, 42] },
          properties: { cluster_id: 7 },
        },
      ],
    });
    map.emitLayer('mouseleave', 'binnacle-notes-symbol', {});

    expect(onSelect).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(map.getCanvas().style.cursor).toBe('crosshair');
  });

  it('disables invisible marker and cluster hit targets until opacity returns', async () => {
    const onSelect = vi.fn();
    const map = { ...createFakeMap(), easeTo: vi.fn() };
    const overlay = createNotesOverlay('http://pi', () => undefined, onSelect);
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    overlay.setOpacity?.(ctx, 0);
    map.emitLayer('mouseenter', 'binnacle-notes-symbol', {});
    map.emitLayer('click', 'binnacle-notes-symbol', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [-83, 42] },
          properties: { id: 'n1', name: 'Marina', category: 'marina' },
        },
      ],
    });
    map.emitLayer('click', 'binnacle-notes-cluster-ring', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [-83, 42] },
          properties: { cluster_id: 7 },
        },
      ],
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(map.getCanvas().style.cursor).toBeFalsy();

    overlay.setOpacity?.(ctx, 1);
    expect(map.getCanvas().style.cursor).toBe('pointer');
    map.emitLayer('click', 'binnacle-notes-symbol', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [-83, 42] },
          properties: { id: 'n1', name: 'Marina', category: 'marina' },
        },
      ],
    });
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('drops a pending cluster zoom when interaction ownership changes', async () => {
    let allowed = true;
    let resolveZoom!: (zoom: number) => void;
    const map = { ...createFakeMap(), easeTo: vi.fn() };
    const overlay = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
      interactionsAllowed: () => allowed,
    });
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    const source = map.sources.get('binnacle-notes');
    if (!source) throw new Error('missing notes source');
    Object.assign(source, {
      getClusterExpansionZoom: () =>
        new Promise<number>((resolve) => {
          resolveZoom = resolve;
        }),
    });

    map.emitLayer('click', 'binnacle-notes-cluster-ring', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [-83, 42] },
          properties: { cluster_id: 7 },
        },
      ],
    });
    allowed = false;
    resolveZoom(12);
    await settle();
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it('drops a pending cluster zoom after the overlay detaches', async () => {
    let resolveZoom!: (zoom: number) => void;
    const map = { ...createFakeMap(), easeTo: vi.fn() };
    const overlay = createNotesOverlay('http://pi', () => undefined);
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    const source = map.sources.get('binnacle-notes');
    if (!source) throw new Error('missing notes source');
    Object.assign(source, {
      getClusterExpansionZoom: () =>
        new Promise<number>((resolve) => {
          resolveZoom = resolve;
        }),
    });

    map.emitLayer('click', 'binnacle-notes-cluster-ring', {
      features: [
        {
          geometry: { type: 'Point', coordinates: [-83, 42] },
          properties: { cluster_id: 7 },
        },
      ],
    });
    overlay.remove(ctx);
    resolveZoom(12);
    await settle();
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  it('highlights a position by ringing it, and clears the ring with undefined', async () => {
    const overlay = createNotesOverlay('http://pi', () => undefined);
    const map = createFakeMap();
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    overlay.highlight(ctx, { latitude: 12, longitude: 34 });
    const ringed = map.sources.get('binnacle-notes-selected-source')?.data as {
      features: { geometry: { coordinates: [number, number] } }[];
    };
    expect(ringed.features).toHaveLength(1);
    // Stored as GeoJSON lon, lat order.
    expect(ringed.features[0].geometry.coordinates).toEqual([34, 12]);

    overlay.highlight(ctx, undefined);
    const cleared = map.sources.get('binnacle-notes-selected-source')?.data as {
      features: unknown[];
    };
    expect(cleared.features).toHaveLength(0);
  });

  it('refetches after an in-flight fetch settles for an area the map has left', async () => {
    let resolveFetch!: (notes: NotePoint[] | undefined) => void;
    fetchNotesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    fetchNotesMock.mockResolvedValue([]);
    const overlay = createNotesOverlay('http://pi', () => undefined);
    const state = { zoom: 12, lng: 0, lat: 0 };
    const ctx = viewCtx(state);
    overlay.sync(ctx);
    await settle(); // let the async persisted-store miss resolve so the fetch is issued
    state.lng = 30;
    overlay.sync(ctx); // in-flight guard: no second fetch yet
    expect(fetchNotesMock).toHaveBeenCalledTimes(1);
    resolveFetch([]);
    await settle();
    // The map is now stationary at the new center, so without the fast-path reset this sync
    // would skip and the overlay would keep showing the old area forever.
    overlay.sync(ctx);
    await settle();
    expect(fetchNotesMock).toHaveBeenCalledTimes(2);
  });

  it('swaps a note to its provided symbol once registered, with the anchor offset', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
        ),
    );
    const rasterize = vi.fn().mockResolvedValue({
      image: { width: 48, height: 48, data: new Uint8ClampedArray(4) } as never,
      cssWidth: 24,
      cssHeight: 24,
      scale: 1,
    });
    const store = storeWith(marinaSymbol(), rasterize);
    fetchNotesMock.mockResolvedValue([MARINA_NOTE]);
    const overlay = createNotesOverlay('http://pi', () => undefined, undefined, store);
    const map = viewFakeMap({ zoom: 12, lng: 0, lat: 0 });
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    await settle();
    expect(map.hasImage(symbolIconId('u9'))).toBe(true);
    await vi.waitFor(() => {
      const fc = map.sources.get('binnacle-notes')?.data as GeoJSON.FeatureCollection;
      expect(fc.features[0].properties).toMatchObject({ icon: symbolIconId('u9') });
    });
    // What this pins: the overlay routed the symbol's anchor offset into the shared builder and
    // applied its result on the layer. The builder's own unit test pins the expression grammar.
    expect(map.setLayoutProperty).toHaveBeenLastCalledWith(
      'binnacle-notes-symbol',
      'icon-offset',
      iconOffsetExpression('icon', new Map([[symbolIconId('u9'), [0, -12]]])),
    );
  });

  it('degrades to the category disc when the symbol SVG fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    const store = storeWith(marinaSymbol(), vi.fn());
    fetchNotesMock.mockResolvedValue([MARINA_NOTE]);
    const overlay = createNotesOverlay('http://pi', () => undefined, undefined, store);
    const map = viewFakeMap({ zoom: 12, lng: 0, lat: 0 });
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    await settle();
    expect(map.hasImage(symbolIconId('u9'))).toBe(false);
    const fc = map.sources.get('binnacle-notes')?.data as GeoJSON.FeatureCollection;
    expect(fc.features[0].properties).toMatchObject({ icon: 'binnacle-poi-marina' });
    // No provided symbol, so the layer's icon-offset stays the centered default.
    expect(map.setLayoutProperty).toHaveBeenLastCalledWith(
      'binnacle-notes-symbol',
      'icon-offset',
      [0, 0],
    );
  });

  it('uses the category disc with a centered offset when no symbols store is passed', async () => {
    fetchNotesMock.mockResolvedValue([MARINA_NOTE]);
    const overlay = createNotesOverlay('http://pi', () => undefined);
    const map = viewFakeMap({ zoom: 12, lng: 0, lat: 0 });
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    await settle();
    const fc = map.sources.get('binnacle-notes')?.data as GeoJSON.FeatureCollection;
    expect(fc.features[0].properties).toMatchObject({ icon: 'binnacle-poi-marina' });
    // No provided symbol, so the layer's icon-offset stays the centered default.
    expect(map.setLayoutProperty).toHaveBeenLastCalledWith(
      'binnacle-notes-symbol',
      'icon-offset',
      [0, 0],
    );
  });

  it('keeps a confirmed personal-note edit visible when its follow-up refresh fails', async () => {
    const personalNotes = new PersonalNotesStore();
    const accepted: NotePoint = {
      ...MARINA_NOTE,
      name: 'Accepted edit',
      ownedByBinnacle: true,
    };
    fetchNotesMock.mockResolvedValueOnce([MARINA_NOTE]).mockResolvedValueOnce(undefined);
    const overlay = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
      personalNotes,
      persist: createExpiringStore<NotePoint[]>('personal', { factory: undefined }),
    });
    const map = viewFakeMap({ zoom: 12, lng: 0, lat: 0 });
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    await settle();

    personalNotes.upsert(accepted);
    personalNotes.requestRefresh();
    overlay.sync(ctx);
    await settle();
    const data = map.sources.get('binnacle-notes')?.data as GeoJSON.FeatureCollection;
    expect(data.features.map((feature) => feature.properties?.name)).toContain('Accepted edit');
    expect(fetchNotesMock).toHaveBeenCalledTimes(2);
  });

  it('shows a confirmed create when the first provider refresh fails', async () => {
    const personalNotes = new PersonalNotesStore();
    const accepted: NotePoint = {
      ...MARINA_NOTE,
      name: 'Accepted create',
      ownedByBinnacle: true,
    };
    personalNotes.upsert(accepted);
    personalNotes.requestRefresh();
    fetchNotesMock.mockResolvedValue(undefined);
    const seen: NotePoint[][] = [];
    const overlay = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
      personalNotes,
      persist: createExpiringStore<NotePoint[]>('personal-create', { factory: undefined }),
      onNotes: (notes) => seen.push(notes),
    });
    const ctx = viewCtx({ zoom: 12, lng: 0, lat: 0 });

    overlay.sync(ctx);
    await settle();

    expect(seen.at(-1)?.map((note) => note.name)).toContain('Accepted create');
    expect(fetchNotesMock).toHaveBeenCalledOnce();
  });

  it('serves a persisted note set to a fresh overlay (a reload) without fetching', async () => {
    const persist = createExpiringStore<NotePoint[]>('shared', { factory: undefined });
    fetchNotesMock.mockResolvedValue([MARINA_NOTE]);
    const first = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
      persist,
    });
    first.sync(viewCtx({ zoom: 12, lng: 0, lat: 0 }));
    await settle();
    expect(fetchNotesMock).toHaveBeenCalledTimes(1);

    const second = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
      persist,
    });
    second.sync(viewCtx({ zoom: 12, lng: 0, lat: 0 }));
    await settle();
    expect(fetchNotesMock).toHaveBeenCalledTimes(1);
  });

  it('keeps serving an expired cached set while offline instead of refetching', async () => {
    vi.useFakeTimers();
    try {
      fetchNotesMock.mockResolvedValue([MARINA_NOTE]);
      let online = true;
      const overlay = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
        isOnline: () => online,
        persist: createExpiringStore<NotePoint[]>('t', { factory: undefined }),
      });
      const state = { zoom: 12, lng: 0, lat: 0 };
      const ctx = viewCtx(state);
      overlay.sync(ctx);
      await settle();
      expect(fetchNotesMock).toHaveBeenCalledTimes(1);

      online = false;
      vi.advanceTimersByTime(6 * 60_000); // past the in-memory TTL
      state.lng = 0.05; // a nudge inside the padded fetch area, so the idle fast-path does not skip
      overlay.sync(ctx);
      await settle();
      // Offline, the expired entry still answers and the POIs stay on the chart.
      expect(fetchNotesMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches an expired set online rather than re-promoting the persisted copy', async () => {
    vi.useFakeTimers();
    try {
      fetchNotesMock.mockResolvedValue([MARINA_NOTE]);
      const overlay = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
        persist: createExpiringStore<NotePoint[]>('t', { factory: undefined }),
      });
      const state = { zoom: 12, lng: 0, lat: 0 };
      const ctx = viewCtx(state);
      overlay.sync(ctx);
      await settle();
      expect(fetchNotesMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(6 * 60_000); // past the in-memory TTL
      state.lng = 30;
      overlay.sync(ctx);
      await settle();
      expect(fetchNotesMock).toHaveBeenCalledTimes(2);

      // Back at the first area: its persisted copy is still within its week, but this session
      // already fetched it, so freshness wins and the network is asked again.
      state.lng = 0;
      overlay.sync(ctx);
      await settle();
      expect(fetchNotesMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands the on-screen note set to onNotes, and empties it below the zoom floor', async () => {
    const notes: NotePoint[] = [
      MARINA_NOTE,
      {
        id: 'n2',
        name: 'Quiet Cove',
        position: { latitude: 0.01, longitude: 0.01 },
        category: 'anchorage',
      },
    ];
    fetchNotesMock.mockResolvedValue(notes);
    const seen: NotePoint[][] = [];
    const overlay = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
      onNotes: (set) => seen.push(set),
    });
    const state = { zoom: 12, lng: 0, lat: 0 };
    const map = viewFakeMap(state);
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    await settle();
    expect(seen.at(-1)?.map((n) => n.id)).toEqual(['n1', 'n2']);

    // Below MIN_ZOOM (9) the overlay clears and reports an empty set so the list does not go stale.
    state.zoom = 8;
    overlay.sync(ctx);
    await settle();
    expect(seen.at(-1)).toEqual([]);
  });

  it('reports loading, ready, zoom-limit, hidden, and error states', async () => {
    fetchNotesMock.mockResolvedValueOnce([MARINA_NOTE]).mockResolvedValueOnce(undefined);
    const states: string[] = [];
    const seen: NotePoint[][] = [];
    const overlay = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
      onNotes: (notes) => seen.push(notes),
      onStatus: (state) => states.push(`${state.phase}:${state.offline}`),
    });
    const state = { zoom: 12, lng: 0, lat: 0 };
    const map = viewFakeMap(state);
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);

    overlay.sync(ctx);
    expect(states.at(-1)).toBe('loading:false');
    await settle();
    expect(states.at(-1)).toBe('ready:false');

    state.zoom = 8;
    overlay.sync(ctx);
    expect(states.at(-1)).toBe('zoomed-out:false');
    expect(seen.at(-1)).toEqual([]);

    overlay.setVisible(ctx, false);
    expect(states.at(-1)).toBe('hidden:false');
    overlay.setVisible(ctx, true);
    expect(states.at(-1)).toBe('idle:false');

    state.zoom = 12;
    state.lng = 30;
    overlay.sync(ctx);
    await settle();
    expect(states.at(-1)).toBe('error:false');
  });

  it('does not repopulate places when hidden during an in-flight request', async () => {
    let resolveFetch!: (notes: NotePoint[]) => void;
    fetchNotesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const seen: NotePoint[][] = [];
    const statuses: string[] = [];
    const overlay = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
      onNotes: (notes) => seen.push(notes),
      onStatus: (state) => statuses.push(state.phase),
    });
    const map = viewFakeMap({ zoom: 12, lng: 0, lat: 0 });
    const ctx = fakeOverlayContext(map);
    await overlay.add(ctx);
    overlay.sync(ctx);
    await settle();
    overlay.setVisible(ctx, false);
    resolveFetch([MARINA_NOTE]);
    await settle();

    expect(seen.at(-1)).not.toEqual([MARINA_NOTE]);
    expect(statuses.at(-1)).toBe('hidden');
  });

  it('labels an offline cache result without fetching again', async () => {
    fetchNotesMock.mockResolvedValue([MARINA_NOTE]);
    let online = true;
    const statuses: { phase: string; offline: boolean }[] = [];
    const overlay = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
      isOnline: () => online,
      persist: createExpiringStore<NotePoint[]>('status', { factory: undefined }),
      onStatus: (state) => statuses.push(state),
    });
    const state = { zoom: 12, lng: 0, lat: 0 };
    const ctx = viewCtx(state);
    overlay.sync(ctx);
    await settle();
    online = false;
    state.lng = 0.05;
    overlay.sync(ctx);
    expect(statuses.at(-1)).toEqual({ phase: 'ready', offline: true });
    expect(fetchNotesMock).toHaveBeenCalledTimes(1);
  });

  it('reports an offline empty state without issuing a provider request', async () => {
    const statuses: { phase: string; offline: boolean }[] = [];
    const seen: NotePoint[][] = [];
    const overlay = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
      isOnline: () => false,
      persist: createExpiringStore<NotePoint[]>('offline-empty', { factory: undefined }),
      onNotes: (notes) => seen.push(notes),
      onStatus: (state) => statuses.push(state),
    });
    overlay.sync(viewCtx({ zoom: 12, lng: 0, lat: 0 }));
    await settle();
    expect(fetchNotesMock).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toEqual({ phase: 'ready', offline: true });
    expect(seen.at(-1) ?? []).toEqual([]);
  });

  it('refreshes immediately when connectivity returns', async () => {
    let online = false;
    fetchNotesMock.mockResolvedValue([MARINA_NOTE]);
    const state = { zoom: 12, lng: 0, lat: 0 };
    const overlay = createNotesOverlay('http://pi', () => undefined, undefined, undefined, {
      isOnline: () => online,
      persist: createExpiringStore<NotePoint[]>('reconnect', { factory: undefined }),
    });
    const ctx = viewCtx(state);
    overlay.sync(ctx);
    await settle();
    online = true;
    overlay.sync(ctx);
    await settle();
    expect(fetchNotesMock).toHaveBeenCalledOnce();
  });

  it('invalidates a fresh cache when the access token changes', async () => {
    let token = 'read';
    fetchNotesMock.mockResolvedValue([MARINA_NOTE]);
    const state = { zoom: 12, lng: 0, lat: 0 };
    const overlay = createNotesOverlay('http://pi', () => token);
    const ctx = viewCtx(state);
    overlay.sync(ctx);
    await settle();
    token = 'readwrite';
    overlay.sync(ctx);
    await settle();
    expect(fetchNotesMock).toHaveBeenCalledTimes(2);
    expect(fetchNotesMock.mock.calls[0][1]).toBe('read');
    expect(fetchNotesMock.mock.calls[1][1]).toBe('readwrite');
  });

  it('retries a failed fetch on a stationary map once the cooldown passes', async () => {
    vi.useFakeTimers();
    try {
      fetchNotesMock.mockResolvedValue(undefined);
      const overlay = createNotesOverlay('http://pi', () => undefined);
      const ctx = viewCtx({ zoom: 12, lng: 0, lat: 0 });
      overlay.sync(ctx);
      await settle();
      expect(fetchNotesMock).toHaveBeenCalledTimes(1);
      overlay.sync(ctx); // still cooling down: no refetch
      await settle();
      expect(fetchNotesMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(31_000);
      overlay.sync(ctx); // cooldown passed: retried without the map moving
      await settle();
      expect(fetchNotesMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

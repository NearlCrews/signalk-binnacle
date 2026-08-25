import type { PersonalNotesStore, PoiViewPhase, PoiViewState } from '$entities/poi';
import { registerPoiIcons } from '$entities/poi-icons';
import { createOverlayIconResolver, type SymbolsStore } from '$entities/symbols';
import { type Bbox4, bboxContains, type LatLon, lngLatBoundsToBbox4, padBbox } from '$shared/geo';
import {
  emptyFeatureCollection,
  type MapThemePaint,
  mapThemePaint,
  type OverlayContext,
  type OverlayModule,
  overlayInteractive,
  type Syncable,
  setLayersVisibility,
  setSourceData,
} from '$shared/map';
import type { ExpiringStore } from '$shared/storage';
import { registerNavaidIcons } from './navaid-symbols';
import { MAX_NOTES_PER_VIEW, type NotePoint, type NoteSelection } from './notes-client';
import { buildRender } from './notes-features';
import { createNoteHitHandlers } from './notes-hit-handlers';
import {
  addNoteLayers,
  CLUSTER_COUNT_LAYER,
  CLUSTER_ICON_LAYER,
  CLUSTER_RING_BASE_OPACITY,
  CLUSTER_RING_LAYER,
  LAYER_ID,
  LAYERS,
  MIN_ZOOM,
  removeNoteLayers,
  SELECT_CASING_LAYER,
  SELECT_LAYER,
  SOURCE_ID,
} from './notes-layers';
import { createSelectRing } from './notes-select-ring';
import { createNotesSource } from './notes-source';

export interface NotesOverlay extends OverlayModule, Syncable {
  // Ring the marker at a position, or clear the ring with undefined. Position-driven so the POI
  // search can highlight a result without a rendered map feature and without moving the map.
  highlight(ctx: OverlayContext, position: LatLon | undefined): void;
}

export interface NotesOverlayOptions {
  // Whether the app believes it is online (the host wires this from OnlineStatus). Offline, an
  // expired cached note set still renders so the POIs do not vanish at TTL expiry with no way to
  // refetch them.
  isOnline?: () => boolean;
  // The cross-reload store for fetched note sets; injectable so tests run on the memory fallback.
  persist?: ExpiringStore<NotePoint[]>;
  // Fired with the on-screen note set whenever it changes, and with [] when the overlay clears below
  // the zoom floor, so a consumer (the POI search) can mirror the chart.
  onNotes?: (notes: NotePoint[]) => void;
  // Reports why the viewport has results, or why it does not, so Find places can distinguish
  // loading, zoom limits, offline cache, provider failure, and an intentionally hidden overlay.
  onStatus?: (state: PoiViewState) => void;
  // A live gate for chart tools that temporarily own every map tap.
  interactionsAllowed?: () => boolean;
  // Session-scoped confirmed personal-note mutations. They are merged over provider snapshots until
  // a successful refresh confirms them, so a failed follow-up load cannot undo an accepted write.
  personalNotes?: PersonalNotesStore;
}

// The Points-of-interest overlay: renders community notes as clustered markers. The where-notes-
// come-from state (persisted store, viewport cache, single-flight fetch, failure cooldown) lives in
// notes-source, the map hit handlers in notes-hit-handlers, and the highlight ring in
// notes-select-ring; this module owns rendering, the icon lifecycle, and the sync orchestration.
export function createNotesOverlay(
  serverBase: string,
  getToken: () => string | undefined,
  onSelect?: (selection: NoteSelection | undefined) => void,
  symbols?: SymbolsStore,
  options: NotesOverlayOptions = {},
): NotesOverlay {
  const isOnline = options.isOnline ?? (() => true);
  const onNotes = options.onNotes;
  const onStatus = options.onStatus;
  const personalNotes = options.personalNotes;
  const source = createNotesSource(serverBase, options.persist);
  const externalInteractionsAllowed = options.interactionsAllowed ?? (() => true);
  let visible = true;
  let opacity = 1;
  const hit = createNoteHitHandlers(onSelect, () =>
    overlayInteractive(visible, opacity, externalInteractionsAllowed),
  );
  const ring = createSelectRing();
  // The exact note array last handed to setData, so a redundant render is skipped and, crucially, a
  // failed fetch keeps it on screen instead of blanking the markers.
  let renderedNotes: NotePoint[] | undefined;
  let renderedRemoteNotes: NotePoint[] | undefined;
  let renderedViewport: Bbox4 | undefined;
  // A fresh overlay has not rendered the session's confirmed-write overlay yet, even when it is
  // reconstructed after an accepted mutation. Start below the store's nonnegative version range so
  // the first sync merges pending personal notes before a provider response can fail.
  let renderedPersonalVersion = personalNotes ? -1 : 0;
  let lastPersonalRefreshVersion = personalNotes?.refreshVersion ?? 0;
  let lastStatus: PoiViewState | undefined;
  let failed = false;
  let requestGeneration = 0;
  let lastToken = getToken();
  let lastOnline = isOnline();
  let forceRefresh = false;
  // The overlay is live as soon as it is constructed so source-only synchronization can warm its
  // cache before map registration. Reset or remove makes deferred work stale until add starts a
  // fresh lifecycle.
  let mounted = true;
  let lifecycle = 0;
  let iconGeneration = 0;

  function report(phase: PoiViewPhase, offline = false): void {
    if (lastStatus?.phase === phase && lastStatus.offline === offline) return;
    lastStatus = { phase, offline };
    onStatus?.(lastStatus);
  }
  let lastZoom: number | undefined;
  let lastLng: number | undefined;
  let lastLat: number | undefined;
  // Force the next sync of a stationary map to re-evaluate cache-or-fetch: the idle fast-path
  // compares against the last synced coordinates, so dropping the zoom anchor is the one named
  // way to break it (after a failed fetch, a cooldown tick, or a move during a fetch).
  const invalidateIdleAnchor = (): void => {
    lastZoom = undefined;
  };
  // The paint to re-raster the icons with, set when the theme changes while hidden so the 18 POI and
  // navaid SVGs are refreshed lazily on the next show rather than re-rasterized while invisible.
  let pendingIconPaint: MapThemePaint | undefined;
  // Provided symbols (signalk-symbol-manager), absent on a stock server. The resolver owns the
  // per-overlay icon registry and the pending-symbol queue; a note's skIcon resolves to a provided
  // symbol via the `note` role, or undefined for the built-in category disc (no symbols store,
  // unresolvable reference, image still loading, or a failed load).
  const iconResolver = createOverlayIconResolver(symbols, (note: NotePoint) =>
    note.skIcon ? symbols?.resolve(note.skIcon, 'note') : undefined,
  );
  let themePaint = mapThemePaint('day');

  // Kick the loads a render queued; each success re-renders the same note set (if still shown)
  // so the now-registered symbol replaces its category disc. A failure resolves false and is
  // remembered by the registry, so the disc simply stays: no missing-image warning either way,
  // because a feature never references an unregistered image id.
  function isCurrent(generation: number): boolean {
    return mounted && generation === lifecycle;
  }

  function ensurePendingIcons(ctx: OverlayContext, notes: NotePoint[], generation: number): void {
    iconResolver.ensurePending(ctx.map, themePaint, () => {
      if (!isCurrent(generation) || renderedNotes !== notes) return;
      const remote = renderedRemoteNotes;
      const viewport = renderedViewport;
      if (!remote || !viewport) return;
      renderedRemoteNotes = undefined;
      render(ctx, remote, viewport, generation);
    });
  }

  // Re-raster the 18 POI and navaid SVGs and the provided symbols to a new theme paint. Run on a
  // theme change while shown and deferred to the next show while hidden.
  async function refreshIcons(ctx: OverlayContext, paint: MapThemePaint): Promise<void> {
    const generation = lifecycle;
    const icons = ++iconGeneration;
    const iconsAreCurrent = (): boolean => isCurrent(generation) && icons === iconGeneration;
    await Promise.all([
      registerPoiIcons(ctx.map, paint, iconsAreCurrent),
      registerNavaidIcons(ctx.map, paint, iconsAreCurrent),
    ]);
    if (iconsAreCurrent()) iconResolver.retheme(ctx.map, paint);
  }

  // Render a note set, skipping the work when it is the same set already shown. Leaving the source
  // untouched on a no-op avoids re-clustering the markers every idle frame.
  function render(
    ctx: OverlayContext,
    remoteNotes: NotePoint[],
    viewport: Bbox4,
    generation = lifecycle,
  ): void {
    const personalVersion = personalNotes?.version ?? 0;
    if (
      !isCurrent(generation) ||
      (remoteNotes === renderedRemoteNotes &&
        personalVersion === renderedPersonalVersion &&
        viewport.every((value, index) => value === renderedViewport?.[index]))
    )
      return;
    renderedRemoteNotes = remoteNotes;
    renderedViewport = viewport;
    renderedPersonalVersion = personalVersion;
    const notes = personalNotes?.merge(remoteNotes, viewport, MAX_NOTES_PER_VIEW) ?? remoteNotes;
    renderedNotes = notes;
    const { data, iconOffset } = buildRender(notes, iconResolver.iconEntry);
    setSourceData(ctx.map, SOURCE_ID, data);
    // The offset is a layer property, not a feature one (MapLibre stringifies an array feature
    // property), so it is restyled here. The getLayer guard mirrors setData's missing-source degrade.
    if (ctx.map.getLayer(LAYER_ID)) ctx.map.setLayoutProperty(LAYER_ID, 'icon-offset', iconOffset);
    ensurePendingIcons(ctx, notes, generation);
    onNotes?.(notes);
  }

  // Clear the shown markers (below the zoom floor) without discarding the cache, so zooming back in
  // re-renders instantly from a recent fetch.
  function clearRendered(ctx: OverlayContext): void {
    if (renderedNotes === undefined) return;
    renderedNotes = undefined;
    renderedRemoteNotes = undefined;
    renderedViewport = undefined;
    setSourceData(ctx.map, SOURCE_ID, emptyFeatureCollection());
    onNotes?.([]);
  }

  report('idle');

  return {
    id: 'notes',
    title: 'Places',
    description: 'Harbors, anchorages, services, and hazards from community chart notes.',
    band: 'routes',
    supportsOpacity: true,
    layerIds: LAYERS,
    async add(ctx) {
      mounted = true;
      lifecycle += 1;
      const before = ctx.beforeIdFor('routes');
      addNoteLayers(ctx.map, themePaint, before);
      ring.reset();
      hit.attach(ctx);
      // Load the category and navaid icons after the layers exist, concurrently; resilient, so a
      // failure here leaves the markers as text labels rather than breaking overlay setup.
      await refreshIcons(ctx, themePaint);
    },
    reset() {
      mounted = false;
      lifecycle += 1;
      iconGeneration += 1;
      iconResolver.invalidate();
      renderedNotes = undefined;
      renderedRemoteNotes = undefined;
      renderedViewport = undefined;
      invalidateIdleAnchor();
      ring.reset();
    },
    sync(ctx) {
      // A hidden layer pays nothing: no network fetch, no clustering, no GeoJSON rebuild. The next
      // show re-syncs from the cache (or fetches) for wherever the map ended up.
      if (!visible) return;
      const token = getToken();
      if (token !== lastToken) {
        lastToken = token;
        requestGeneration += 1;
        source.invalidate();
        failed = false;
        invalidateIdleAnchor();
      }
      const online = isOnline();
      if (online !== lastOnline) {
        // Reconnect asks the provider immediately instead of waiting for the five-minute cache TTL.
        // Going offline keeps the cache intact so an expired set can still answer.
        if (online) forceRefresh = true;
        lastOnline = online;
        invalidateIdleAnchor();
      }
      const zoom = ctx.map.getZoom();
      const center = ctx.map.getCenter();
      const personalVersion = personalNotes?.version ?? 0;
      const personalChanged = personalVersion !== renderedPersonalVersion;
      const personalRefreshVersion = personalNotes?.refreshVersion ?? 0;
      if (personalRefreshVersion !== lastPersonalRefreshVersion) {
        lastPersonalRefreshVersion = personalRefreshVersion;
        requestGeneration += 1;
        source.invalidate();
        forceRefresh = true;
        invalidateIdleAnchor();
      } else if (personalChanged) {
        invalidateIdleAnchor();
      }
      // Idle fast-path: nothing moved since the last sync, so skip the viewport work entirely.
      if (zoom === lastZoom && center.lng === lastLng && center.lat === lastLat) return;
      lastZoom = zoom;
      lastLng = center.lng;
      lastLat = center.lat;
      if (zoom < MIN_ZOOM) {
        clearRendered(ctx);
        report('zoomed-out');
        return;
      }
      const viewport: Bbox4 = lngLatBoundsToBbox4(ctx.map.getBounds());
      // A confirmed create can arrive before the first provider collection finishes. Render it over
      // an empty remote snapshot immediately, so a failed first refresh cannot leave the accepted
      // note absent from the chart and Find places.
      if (personalChanged) render(ctx, renderedRemoteNotes ?? [], viewport);
      // A recent fetch whose padded area still covers the viewport serves the markers with no
      // network. This runs before the in-flight guard, so a cache hit renders even mid-fetch.
      const cached = forceRefresh ? undefined : source.cached(viewport, !online);
      if (cached) {
        failed = false;
        report('ready', !online);
        render(ctx, cached, viewport);
        return;
      }
      if (source.inFlight()) {
        report('loading');
        return;
      }
      if (online && source.coolingDown()) {
        // Still backing off from a failed fetch; retry once the cooldown passes, even stationary.
        invalidateIdleAnchor();
        report(failed ? 'error' : 'loading');
        return;
      }
      // Fetch a padded area so the next small pan or zoom-in reuses this fetch from the cache.
      const fetchBbox = padBbox(viewport);
      forceRefresh = false;
      report('loading');
      const loadGeneration = requestGeneration;
      const loadToken = token;
      const loadOnline = online;
      void source.load(fetchBbox, loadToken, loadOnline).then((notes) => {
        if (
          loadGeneration !== requestGeneration ||
          getToken() !== loadToken ||
          isOnline() !== loadOnline
        ) {
          return;
        }
        // Hiding or removing the overlay while a request is in flight keeps the successful response
        // cached, but it must not repopulate the list or replace the explicit hidden state.
        if (!mounted || !visible) {
          invalidateIdleAnchor();
          return;
        }
        // undefined is a transient failure: keep the markers already shown and retry after the
        // source's cooldown, even stationary (the fast-path would otherwise pin the failure
        // forever). An empty array is a real "no POIs here" answer, so it renders and clears them.
        if (!notes) {
          failed = true;
          report('error');
          invalidateIdleAnchor();
          return;
        }
        failed = false;
        report('ready', !loadOnline);
        const current: Bbox4 = lngLatBoundsToBbox4(ctx.map.getBounds());
        personalNotes?.reconcile(notes, fetchBbox, notes.length < MAX_NOTES_PER_VIEW);
        render(ctx, notes, current);
        // The map may have moved while the fetch was in flight; when this fetch no longer covers
        // the current viewport, drop the fast-path anchor so the next sync serves the new area.
        if (!bboxContains(fetchBbox, current)) invalidateIdleAnchor();
      });
    },
    highlight(ctx, position) {
      ring.draw(ctx, position);
    },
    applyTheme(ctx, paint) {
      themePaint = paint;
      // The cheap per-layer color updates always run so the layer is correct the instant it shows.
      // The expensive icon re-raster (18 SVGs) is deferred while hidden and done on the next show.
      if (visible) {
        void refreshIcons(ctx, paint);
      } else {
        pendingIconPaint = paint;
      }
      ctx.map.setPaintProperty(LAYER_ID, 'text-color', paint.note);
      ctx.map.setPaintProperty(LAYER_ID, 'text-halo-color', paint.background);
      ctx.map.setPaintProperty(CLUSTER_RING_LAYER, 'circle-stroke-color', paint.markerGlyph);
      ctx.map.setPaintProperty(CLUSTER_COUNT_LAYER, 'text-color', paint.markerGlyph);
      ctx.map.setPaintProperty(CLUSTER_COUNT_LAYER, 'text-halo-color', paint.note);
      ctx.map.setPaintProperty(SELECT_LAYER, 'circle-stroke-color', paint.select);
    },
    setVisible(ctx, isVisible) {
      visible = isVisible;
      hit.refreshInteractionState();
      setLayersVisibility(ctx.map, LAYERS, isVisible);
      if (!isVisible) {
        clearRendered(ctx);
        report('hidden');
      } else {
        invalidateIdleAnchor();
        report('idle');
      }
      // If the theme changed while hidden, refresh the icons now that the layer is shown again.
      if (isVisible && pendingIconPaint) {
        const paint = pendingIconPaint;
        pendingIconPaint = undefined;
        void refreshIcons(ctx, paint);
      }
    },
    setOpacity(ctx, next) {
      opacity = next;
      hit.refreshInteractionState();
      ctx.map.setPaintProperty(LAYER_ID, 'icon-opacity', next);
      ctx.map.setPaintProperty(LAYER_ID, 'text-opacity', next);
      ctx.map.setPaintProperty(CLUSTER_ICON_LAYER, 'icon-opacity', next);
      ctx.map.setPaintProperty(
        CLUSTER_RING_LAYER,
        'circle-stroke-opacity',
        next * CLUSTER_RING_BASE_OPACITY,
      );
      ctx.map.setPaintProperty(CLUSTER_COUNT_LAYER, 'text-opacity', next);
      ctx.map.setPaintProperty(SELECT_CASING_LAYER, 'circle-stroke-opacity', next);
      ctx.map.setPaintProperty(SELECT_LAYER, 'circle-stroke-opacity', next);
    },
    remove(ctx) {
      mounted = false;
      lifecycle += 1;
      iconGeneration += 1;
      iconResolver.invalidate();
      visible = false;
      renderedRemoteNotes = undefined;
      renderedViewport = undefined;
      hit.detach(ctx);
      removeNoteLayers(ctx.map);
      onNotes?.([]);
      report('hidden');
    },
  };
}

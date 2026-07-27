import type { ChartGroup } from 'signalk-chart-sources';

import type { MapThemePaint } from './map-theme';
import { installSentinels, sentinelId } from './sentinels';
import {
  type ChartLayerInfo,
  type OverlayContext,
  type OverlayModule,
  Z_ORDER,
  type ZBand,
} from './types';

// Precomputed band-to-stacking-rank lookup so an overlay's band order is an O(1) read rather than a
// linear Z_ORDER scan on every effective-order pass.
const Z_RANK = new Map<ZBand, number>(Z_ORDER.map((band, i) => [band, i]));

export interface OverlayState {
  visible: boolean;
  opacity: number;
}

// Per-layer visibility and opacity, keyed by overlay id, for save and restore.
export type LayerSettings = Record<string, OverlayState>;

export interface LayerListItem {
  id: string;
  title: string;
  // A plain-language gloss for the row's hover tooltip. See OverlayModule.description.
  description?: string;
  visible: boolean;
  opacity: number;
  supportsOpacity: boolean;
  // A pinned layer (own vessel, active alarms) is locked to the top and cannot be reordered.
  pinned: boolean;
  // The overlay's z-band, used by the panel to group charts and depth apart from live overlays.
  band: ZBand;
  // The parent overlay id when this is a sub-layer (the panel nests it under its parent).
  parent?: string;
  // The named group this layer is a facet of, surfaced so the panel can render one group header
  // above the group's facets. See OverlayModule.group.
  group?: ChartGroup;
  // The Layers-panel category this layer declares. See OverlayModule.category.
  category?: string;
  // The region tag (US, EU, Global) shown on the row. See OverlayModule.region.
  region?: string;
  // False when the overlay's provider or data is absent: the panel grays the row and disables its
  // toggle. See OverlayModule.available. A snapshot taken at layers() time, so the host calls
  // LayersView.refresh() when an availability-gating value changes (App.svelte does this in an effect).
  available: boolean;
  // The hover tooltip for a grayed-out row. See OverlayModule.unavailableHint.
  unavailableHint?: string;
  // The row has a settings gear that asks the host to open this overlay's controls. See
  // OverlayModule.manageable.
  manageable?: boolean;
  // Present when this row represents a chart source, so the Layers panel can expose chart-source
  // detail without knowing how the overlay renders.
  chart?: ChartLayerInfo;
}

export interface LayerManagerOptions {
  // Settings to restore on register (a layer absent here takes the visible default).
  saved?: LayerSettings;
  // Called with the full settings snapshot whenever a layer's state changes.
  onChange?: (settings: LayerSettings) => void;
  // Persisted bottom-to-top order of non-pinned overlay ids, and the callback to persist it.
  savedOrder?: string[];
  onOrderChange?: (order: string[]) => void;
  // Overlay ids pinned to the top of the stack, in bottom-to-top order, so the vessel and
  // active alarms can never be hidden beneath a chart. The core stays generic: the wiring
  // decides which ids are pinned rather than the manager hardcoding any feature.
  pinned?: string[];
  // Groups of overlay ids that are mutually exclusive: enabling one hides the others in its group.
  // The wiring decides the groups (the weather area fills) rather than the manager hardcoding any.
  exclusive?: string[][];
}

type LayerRegistrationResult =
  | { id: string; status: 'registered' }
  | { id: string; status: 'failed'; error: unknown };

interface ActiveRegistration {
  module: OverlayModule;
  canceled: boolean;
}

export class LayerManager {
  #ctx: OverlayContext;
  #modules = new Map<string, OverlayModule>();
  #state = new Map<string, OverlayState>();
  // An async add can be canceled by unregister before it finishes. Keep its identity and completion
  // task separate from the public module map so a same-id replacement waits for the canceled add's
  // final cleanup, and a stale catch cannot delete the replacement's state.
  #registrations = new Map<string, ActiveRegistration>();
  #registrationTasks = new Map<string, Promise<void>>();
  #disposed = false;
  #saved: LayerSettings;
  #onChange?: (settings: LayerSettings) => void;
  // The explicit user order (bottom to top) of non-pinned overlays; seeds the effective order.
  #explicitOrder: string[];
  #onOrderChange?: (order: string[]) => void;
  #pinned: Set<string>;
  #exclusive: string[][];
  // The last theme paint broadcast, so a module registered after the first recolor (an imported
  // user chart) is themed at add time instead of staying day-colored until the next theme change.
  #lastPaint?: MapThemePaint;

  constructor(ctx: OverlayContext, options: LayerManagerOptions = {}) {
    this.#ctx = ctx;
    this.#saved = options.saved ?? {};
    this.#onChange = options.onChange;
    this.#explicitOrder = options.savedOrder ? [...options.savedOrder] : [];
    this.#onOrderChange = options.onOrderChange;
    this.#pinned = new Set(options.pinned ?? []);
    this.#exclusive = options.exclusive ?? [];
  }

  async register(module: OverlayModule): Promise<void> {
    await this.#addModule(module);
    this.#applyOrder();
  }

  // Register many overlays as one batch, applying the stacking order a single time at the end
  // rather than after every module. The initial chart-plus-overlay load registers a dozen or more
  // modules, and a per-register restack is a moveLayer chain over every layer each time, so the
  // batch turns a quadratic load-time cost into one restack. The final order is identical to
  // registering the same modules in the same sequence one at a time.
  async registerAll(modules: OverlayModule[]): Promise<void> {
    const results = await this.registerBatch(modules);
    const failures = results.filter(
      (result): result is Extract<LayerRegistrationResult, { status: 'failed' }> =>
        result.status === 'failed',
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.error),
        `Could not register ${failures.length} overlay${failures.length === 1 ? '' : 's'}.`,
      );
    }
  }

  // Register independent overlay modules without allowing one optional provider failure to prevent
  // the remaining modules from mounting. Each failed add is rolled back by #addModule, registration
  // order is preserved, and the map is restacked exactly once after the batch settles.
  async registerBatch(modules: OverlayModule[]): Promise<LayerRegistrationResult[]> {
    const results: LayerRegistrationResult[] = [];
    for (const module of modules) {
      try {
        await this.#addModule(module);
        results.push({ id: module.id, status: 'registered' });
      } catch (error) {
        results.push({ id: module.id, status: 'failed', error });
      }
    }
    this.#applyOrder();
    return results;
  }

  // Add a single module (state restore, exclusion enforcement, add, visibility, and opacity)
  // without restacking. register and registerAll share this and own when #applyOrder runs.
  async #addModule(module: OverlayModule): Promise<void> {
    if (this.#disposed) throw new Error('layer manager is disposed');
    const previous = this.#registrationTasks.get(module.id);
    if (previous) await previous.catch(() => undefined);
    if (this.#disposed) throw new Error('layer manager is disposed');
    if (this.#modules.has(module.id)) {
      throw new Error(`duplicate overlay id: ${module.id}`);
    }
    const registration: ActiveRegistration = { module, canceled: false };
    this.#registrations.set(module.id, registration);
    this.#modules.set(module.id, module);
    const restored = this.#saved[module.id];
    // Coerce a restored state's shape: a legacy persisted entry missing opacity would otherwise
    // flow undefined into setOpacity and render as NaN.
    const state = restored
      ? {
          visible: Boolean(restored.visible),
          opacity: this.#coerceOpacity(restored.opacity),
        }
      : { visible: module.defaultVisible ?? true, opacity: module.defaultOpacity ?? 1 };
    // Enforce exclusion on restore too: a saved or legacy state with two members of an exclusive
    // group both visible would otherwise bypass the toggle-time rule. Keep the first registered.
    if (state.visible) {
      const group = this.#groupOf(module.id);
      if (group?.some((other) => other !== module.id && this.#state.get(other)?.visible)) {
        state.visible = false;
      }
    }
    this.#state.set(module.id, state);
    const task = this.#finishAdd(module, state, registration);
    this.#registrationTasks.set(module.id, task);
    try {
      await task;
    } finally {
      if (this.#registrationTasks.get(module.id) === task) {
        this.#registrationTasks.delete(module.id);
      }
    }
  }

  async #finishAdd(
    module: OverlayModule,
    state: OverlayState,
    registration: ActiveRegistration,
  ): Promise<void> {
    let removedAfterAdd = false;
    try {
      await module.add(this.#ctx);
      // An async add can finish after the owning map has been torn down or the id was unregistered.
      // The first remove cleans partial work immediately; this second pass removes anything the late
      // continuation installed. A replacement cannot start until this task settles.
      if (
        this.#disposed ||
        registration.canceled ||
        this.#registrations.get(module.id) !== registration
      ) {
        try {
          module.remove(this.#ctx);
        } catch {
          // The map or the first cleanup may already have removed every resource.
        }
        removedAfterAdd = true;
        throw new Error(
          this.#disposed ? 'layer manager is disposed' : 'overlay registration canceled',
        );
      }
      // `state` is the exact object held in #state, and the visibility and opacity setters mutate
      // it in place, so this re-apply picks up changes made while add() was awaited. Overlays skip
      // paint updates until their layers exist, and this pass is what recovers those skips; if
      // #state ever moves to replace-on-write, this must re-read the current entry instead.
      module.setVisible(this.#ctx, state.visible);
      module.setOpacity?.(this.#ctx, state.opacity);
      if (this.#lastPaint) module.applyTheme?.(this.#ctx, this.#lastPaint);
    } catch (error) {
      if (!removedAfterAdd) {
        try {
          module.remove(this.#ctx);
        } catch {
          // Best-effort rollback: an add that failed before creating map resources may have nothing
          // to remove. The original add error is the useful failure for the caller.
        }
      }
      if (this.#registrations.get(module.id) === registration) {
        this.#registrations.delete(module.id);
        this.#modules.delete(module.id);
        this.#state.delete(module.id);
      }
      throw error;
    }
  }

  unregister(id: string): void {
    const registration = this.#registrations.get(id);
    const module = registration?.module ?? this.#modules.get(id);
    if (!module) return;
    if (registration) registration.canceled = true;
    try {
      module.remove(this.#ctx);
    } catch (error) {
      console.warn(`Could not remove overlay "${module.id}".`, error);
    }
    if (!registration || this.#registrations.get(id) === registration) {
      this.#registrations.delete(id);
      this.#modules.delete(id);
      this.#state.delete(id);
    }
    // Drop the state and order entries too, and persist, so a deleted overlay (a removed user
    // chart) does not live on in the saved snapshot forever.
    if (this.#explicitOrder.includes(id)) {
      this.#explicitOrder = this.#explicitOrder.filter((other) => other !== id);
      this.#onOrderChange?.([...this.#explicitOrder]);
    }
    this.#persist();
  }

  // Tear down every registered module before the owning MapLibre instance is removed. Reverse
  // registration order mirrors stack unwinding, and clearing first makes repeated disposal a no-op
  // even if one module's cleanup throws through a host integration.
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const registration of this.#registrations.values()) registration.canceled = true;
    const modules = [...this.#modules.values()].reverse();
    this.#registrations.clear();
    this.#modules.clear();
    this.#state.clear();
    for (const module of modules) {
      try {
        module.remove(this.#ctx);
      } catch (error) {
        console.warn(`Could not remove overlay "${module.id}".`, error);
      }
    }
  }

  toggle(id: string, visible: boolean): void {
    const module = this.#modules.get(id);
    const state = this.#state.get(id);
    if (!module || !state) return;
    // Enabling a member of an exclusive group hides the other members of that group.
    if (visible) {
      const group = this.#groupOf(id);
      for (const other of group ?? []) {
        if (other === id) continue;
        const om = this.#modules.get(other);
        const os = this.#state.get(other);
        if (om && os?.visible) {
          os.visible = false;
          om.setVisible(this.#ctx, false);
        }
      }
    }
    state.visible = visible;
    module.setVisible(this.#ctx, visible);
    // Turning a parent off hides its sub-layers, so a facet (the data-quality overlay) never lingers
    // on the map without the chart it annotates. The panel also disables a sub-layer's toggle while
    // its parent is off, so this only fires when the parent goes off with a child still on.
    if (!visible) {
      for (const [childId, child] of this.#modules) {
        if (child.parent !== id) continue;
        const childState = this.#state.get(childId);
        if (childState?.visible) {
          childState.visible = false;
          child.setVisible(this.#ctx, false);
        }
      }
    }
    this.#persist();
  }

  setOpacity(id: string, opacity: number): void {
    const module = this.#modules.get(id);
    const state = this.#state.get(id);
    if (!module || !state) return;
    state.opacity = opacity;
    module.setOpacity?.(this.#ctx, opacity);
    this.#persist();
  }

  // Move a non-pinned overlay to a new index in the non-pinned, top-to-bottom display order
  // (index 0 is the top of the map). Pinned layers are never moved or displaced.
  reorder(id: string, toIndex: number): void {
    if (this.#pinned.has(id) || !this.#modules.has(id)) return;
    // A sub-layer is never reordered on its own; it stays directly above its parent.
    if (this.#isChild(id)) return;
    const topDown = this.#effectiveOrder()
      .filter((other) => !this.#pinned.has(other) && !this.#isChild(other))
      .reverse();
    const from = topDown.indexOf(id);
    topDown.splice(from, 1);
    const clamped = Math.max(0, Math.min(toIndex, topDown.length));
    topDown.splice(clamped, 0, id);
    this.#explicitOrder = topDown.reverse();
    this.#applyOrder();
    this.#onOrderChange?.([...this.#explicitOrder]);
  }

  // Apply a full settings snapshot and a new explicit stacking order in one pass, for profile
  // switching. The batch persists and fires the order-change callback exactly once at the end
  // rather than per layer, so swapping a profile is a single store write and a single restack.
  // It deliberately does NOT re-run exclusive-group enforcement: the snapshot was a valid state
  // when it was captured, so re-enforcing here could suppress a layer the saved profile kept on.
  applySnapshot(settings: LayerSettings, order: string[]): void {
    if (this.#disposed) return;
    for (const [id, module] of this.#modules) {
      const next = settings[id];
      const state = this.#state.get(id);
      if (!next || !state) continue;
      if (next.visible !== state.visible) {
        state.visible = next.visible;
        module.setVisible(this.#ctx, next.visible);
      }
      // Coerce as #addModule does: a corrupted or legacy snapshot opacity (NaN or out of range)
      // would otherwise flow into setOpacity and render the layer transparent or broken.
      const opacity = this.#coerceOpacity(next.opacity);
      if (opacity !== state.opacity) {
        state.opacity = opacity;
        module.setOpacity?.(this.#ctx, opacity);
      }
    }
    this.#explicitOrder = [...order];
    this.#applyOrder();
    this.#persist();
    this.#onOrderChange?.([...this.#explicitOrder]);
  }

  #persist(): void {
    if (!this.#onChange) return;
    const snapshot: LayerSettings = {};
    for (const [id, state] of this.#state) {
      snapshot[id] = { visible: state.visible, opacity: state.opacity };
    }
    this.#onChange(snapshot);
  }

  #isChild(id: string): boolean {
    return this.#modules.get(id)?.parent !== undefined;
  }

  // Clamp a restored or snapshot opacity into [0, 1]: a legacy persisted entry missing opacity, or
  // a corrupted out-of-range value, would otherwise flow undefined or NaN into setOpacity and
  // render the layer as NaN, transparent, or broken.
  #coerceOpacity(value: unknown): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : 1;
  }

  #groupOf(id: string): string[] | undefined {
    return this.#exclusive.find((g) => g.includes(id));
  }

  // The effective stacking order, bottom to top: pinned overlays on top, the rest by the
  // saved explicit order, with any overlay missing from it slotted in at its band default.
  // Recomputed per call rather than memoized: the overlay count is small (a dozen at most) and a
  // cache would need invalidating on every register, unregister, reorder, pin, and snapshot, where a
  // stale entry would mis-stack layers.
  #effectiveOrder(): string[] {
    const bandRank = (id: string): number =>
      Z_RANK.get(this.#modules.get(id)?.band ?? 'basemap') ?? 0;
    const nonPinned = [...this.#modules.keys()].filter((id) => !this.#pinned.has(id));
    // Order the top-level overlays only. A sub-layer is not positioned on its own: it is slotted
    // directly above its parent below, so it never drifts from the chart it annotates and never
    // becomes its own reorderable row.
    const topLevel = new Set(nonPinned.filter((id) => !this.#isChild(id)));
    const seq = this.#explicitOrder.filter((id) => topLevel.has(id));
    // inSeq tracks membership in seq for O(1) has-check; posInSeq maps id to index for O(1) parent
    // lookup. Both are kept in sync with every splice so the findIndex loop below stays off seq.
    const inSeq = new Set(seq);
    const posInSeq = new Map(seq.map((id, i) => [id, i]));
    // Precompute band ranks for the current seq contents so the insertion loop never calls
    // bandRank(other) per element.
    const seqRanks: number[] = seq.map((id) => bandRank(id));
    for (const id of topLevel) {
      if (inSeq.has(id)) continue;
      const rank = bandRank(id);
      let at = seqRanks.findIndex((r) => r > rank);
      if (at < 0) at = seq.length;
      seq.splice(at, 0, id);
      seqRanks.splice(at, 0, rank);
      inSeq.add(id);
      // posInSeq is used only for parent lookup below, so a full rebuild is acceptable here;
      // the number of top-level overlays is small (a dozen at most) and this path runs once per
      // missing id, not per element per insertion.
      for (let k = at; k < seq.length; k++) posInSeq.set(seq[k], k);
    }
    for (const id of nonPinned) {
      const parent = this.#modules.get(id)?.parent;
      if (parent === undefined) continue;
      const at = posInSeq.get(parent);
      if (at !== undefined) {
        seq.splice(at + 1, 0, id);
        // Update posInSeq for the inserted child and every element that shifted right.
        for (let k = at + 1; k < seq.length; k++) posInSeq.set(seq[k], k);
      } else seq.push(id);
    }
    const pinned = [...this.#pinned].filter((id) => this.#modules.has(id));
    return [...seq, ...pinned];
  }

  // Realize the effective order on the map by chaining moveLayer from the top down, anchoring
  // the whole overlay group just beneath the top sentinel so it stays above the base style.
  #applyOrder(order = this.#effectiveOrder()): void {
    if (this.#disposed) return;
    // Band insertion already yields the default order, so a restack only matters once a saved
    // order or a pin makes the desired order differ from the plain band sequence.
    if (!this.#explicitOrder.length && !this.#pinned.size) return;
    const desired: string[] = [];
    for (const id of order) {
      const module = this.#modules.get(id);
      if (!module) continue;
      for (const layerId of module.layerIds) {
        if (this.#ctx.map.getLayer(layerId)) desired.push(layerId);
      }
    }
    const anchor = sentinelId('overlay-top');
    let cursor = this.#ctx.map.getLayer(anchor) ? anchor : undefined;
    for (let k = desired.length - 1; k >= 0; k--) {
      this.#ctx.map.moveLayer(desired[k], cursor);
      cursor = desired[k];
    }
  }

  // Broadcast a theme change to every overlay that recolors itself, so each slice owns
  // the theming of its own layers instead of the widget reaching into them by id.
  applyTheme(paint: MapThemePaint): void {
    if (this.#disposed) return;
    this.#lastPaint = paint;
    for (const module of this.#modules.values()) {
      module.applyTheme?.(this.#ctx, paint);
    }
  }

  // The entry point for a full base-style swap: it re-adds every overlay onto the fresh style.
  // No in-app action swaps the base style yet (theme changes recolor in place), so this is forward
  // scaffolding for that path, exercised by tests and ready for when a style swap lands.
  async reattachAll(): Promise<void> {
    if (this.#disposed) return;
    // A base-style swap wipes the sentinel layers too, so restore them before
    // re-adding overlays or every beforeId would point at a missing layer.
    installSentinels(this.#ctx.map);
    for (const [id, module] of this.#modules) {
      const state = this.#state.get(id) ?? { visible: true, opacity: 1 };
      // The swap recreated this overlay's sources empty, so invalidate its change-detection cache
      // before re-adding, so the next sync repopulates rather than early-returning as unchanged.
      module.reset?.();
      try {
        await (module.reattach ?? module.add).call(module, this.#ctx);
      } catch (error) {
        try {
          module.remove(this.#ctx);
        } catch {
          // Keep the reattach failure as the useful error when partial cleanup is also unavailable.
        }
        throw error;
      }
      if (this.#disposed) {
        // The reattach completed after disposal and may have recreated map resources after the
        // first cleanup pass. Remove them now, then stop the batch without touching map state.
        try {
          module.remove(this.#ctx);
        } catch {
          // The map may already have removed its style. Cleanup remains best effort here.
        }
        return;
      }
      module.setVisible(this.#ctx, state.visible);
      module.setOpacity?.(this.#ctx, state.opacity);
      if (this.#lastPaint) module.applyTheme?.(this.#ctx, this.#lastPaint);
    }
    this.#applyOrder();
  }

  // The layer list for the panel, top of the map first, so the panel's top row is the top layer.
  layers(): LayerListItem[] {
    return this.#effectiveOrder()
      .reverse()
      .flatMap((id) => {
        const module = this.#modules.get(id);
        if (!module) return [];
        if (module.listed === false) return [];
        const state = this.#state.get(id) ?? { visible: true, opacity: 1 };
        return [
          {
            id,
            title: module.title,
            description: module.description,
            visible: state.visible,
            opacity: state.opacity,
            supportsOpacity: module.supportsOpacity,
            pinned: this.#pinned.has(id),
            band: module.band,
            parent: module.parent,
            group: module.group,
            category: module.category,
            region: module.region,
            available: module.available?.() ?? true,
            unavailableHint: module.unavailableHint,
            manageable: module.manageable,
            chart: module.chart,
          },
        ];
      });
  }
}

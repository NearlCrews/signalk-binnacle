<script lang="ts">
import { ChevronRight, Lock, Plus, RefreshCw } from '@lucide/svelte';
import type { UserCharts } from '$entities/user-charts';
import type { Bbox4 } from '$shared/geo';
import type { LayerListItem } from '$shared/map';
import type { PersistedValue } from '$shared/settings';
import type { AuthController } from '$shared/signalk';
import { createPanelMinimize, SlideOver } from '$shared/ui';
import AddChartForm from './AddChartForm.svelte';
import LayerRow from './LayerRow.svelte';
import { CATEGORY_DEFAULT_OPEN, CATEGORY_ORDER, layerCategory } from './layer-category';
import { createLayerReorder } from './layers-reorder.svelte';
import type { LayersView } from './layers-view.svelte';
import SourceDetail from './SourceDetail.svelte';

interface Props {
  view: LayersView;
  auth: AuthController;
  chartsLoadState?: 'loading' | 'ready' | 'partial' | 'error';
  onRetryCharts?: () => void;
  userCharts?: UserCharts;
  // Per-category open/closed state, persisted so the panel reopens the way it was left.
  categoriesOpen?: PersistedValue<Record<string, boolean>>;
  onClose: () => void;
  onBack?: () => void;
  // A manageable overlay row (one declaring manageable on its module, like the marine radar) asks the
  // host to open its own controls. The host owns the panel content, so this generic panel imports no
  // feature; it just forwards the row id.
  onManageLayer?: (id: string) => void;
  onShowChartBounds?: (bounds: Bbox4) => void;
  initialMode?: 'charts' | 'overlays';
}

const {
  view,
  auth,
  chartsLoadState = 'ready',
  onRetryCharts,
  userCharts,
  categoriesOpen,
  onClose,
  onBack,
  onManageLayer,
  onShowChartBounds,
  initialMode = 'charts',
}: Props = $props();

const pinned = $derived(view.items.filter((item) => item.pinned));
// Sub-layers (a chart facet, for example the NOAA ENC data quality overlay) are not their own
// movable rows: they nest under their parent's row, so they are excluded from the reorderable list
// and grouped by parent id below.
const movable = $derived(view.items.filter((item) => !item.pinned && !item.parent));
const childrenByParent = $derived.by(() => {
  const map = new Map<string, LayerListItem[]>();
  for (const item of view.items) {
    if (!item.parent) continue;
    const list = map.get(item.parent);
    if (list) list.push(item);
    else map.set(item.parent, [item]);
  }
  return map;
});

// Bucket the movable rows into categories, keeping each row's index in `movable` so the drag handlers
// (which address rows by their movable index) keep working unchanged. The categories render in
// CATEGORY_ORDER, which matches the map z-order, so the panel order equals the stack and a collapsed
// category's rows stay in the DOM (hidden) in their movable position.
const categories = $derived.by(() => {
  const byId = new Map<string, { title: string; rows: { item: LayerListItem; i: number }[] }>();
  movable.forEach((item, i) => {
    const cat = layerCategory(item);
    const bucket = byId.get(cat.id);
    if (bucket) bucket.rows.push({ item, i });
    else byId.set(cat.id, { title: cat.title, rows: [{ item, i }] });
  });
  return CATEGORY_ORDER.flatMap((id) => {
    const bucket = byId.get(id);
    return bucket ? [{ id, title: bucket.title, rows: bucket.rows }] : [];
  });
});
const chartRows = $derived.by(() =>
  movable.flatMap((item, i) => (layerCategory(item).id === 'charts' ? [{ item, i }] : [])),
);
const overlayCategories = $derived(categories.filter((cat) => cat.id !== 'charts'));

function isOpen(id: string): boolean {
  return categoriesOpen?.value[id] ?? CATEGORY_DEFAULT_OPEN[id] ?? true;
}

function toggleCategory(id: string): void {
  if (!categoriesOpen) return;
  categoriesOpen.set({ ...categoriesOpen.value, [id]: !isOpen(id) });
}

let addOpen = $state(false);
let detailId = $state<string | undefined>();
let mode = $state<'charts' | 'overlays'>('charts');
$effect(() => {
  mode = initialMode;
});
const minimize = createPanelMinimize();
const detailItem = $derived(detailId ? view.items.find((item) => item.id === detailId) : undefined);
const detailUserSource = $derived(
  detailItem?.chart?.source === 'user'
    ? userCharts?.sources.find((source) => source.id === detailItem.chart?.identifier)
    : undefined,
);

let listEl = $state<HTMLUListElement>();

// The imperative pointer-and-keyboard drag-reorder controller, given the live list element so it
// can measure rows and refocus the moved handle. It owns the drag state and announcement; the
// template reads them back through its getters.
const reorder = createLayerReorder(
  () => view,
  () => movable,
  () => listEl,
);
</script>

<!-- While a chart detail is open it shows its own "Back to layers" control, so the panel-level
     "Back to menu" arrow is suppressed to avoid two stacked back buttons.
     bodyFlex is intentionally omitted: this body is a continuous accordion list that manages its own
     section spacing, unlike the readout panels that rely on SlideOver's flow rhythm. -->
<SlideOver
  title="Layers and charts"
  closeLabel="Close layers and charts"
  {onClose}
  onBack={detailItem ? undefined : onBack}
  {minimize}
>
  <div class="visually-hidden" aria-live="polite">{reorder.reorderAnnouncement}</div>
  {#if detailItem?.chart}
    {#key detailItem.id}
      <SourceDetail
        item={detailItem}
        {userCharts}
        userSource={detailUserSource}
        writeBlocked={auth.writeBlocked}
        onBack={() => (detailId = undefined)}
        onShowBounds={(bounds) => {
          onShowChartBounds?.(bounds);
          minimize.collapse();
        }}
      />
    {/key}
  {:else}
    <p class="muted-note">Choose chart sources, then tune overlays and stacking for the chart.</p>

    <div class="segmented layer-tabs" role="group" aria-label="Layers and charts view">
      <button
        type="button"
        class="btn"
        class:is-on={mode === 'charts'}
        aria-pressed={mode === 'charts'}
        onclick={() => (mode = 'charts')}
      >
        Charts
      </button>
      <button
        type="button"
        class="btn"
        class:is-on={mode === 'overlays'}
        aria-pressed={mode === 'overlays'}
        onclick={() => (mode = 'overlays')}
      >
        Overlays
      </button>
    </div>

    {#if mode === 'charts'}
      {#if auth.writeBlocked}
        <p class="muted-note" role="status">
          A write token is needed to add, rename, or delete URL charts. Request a read/write token
          to continue.
        </p>
      {/if}
      {#if chartsLoadState === 'loading'}
        <p class="muted-note" role="status">Loading Signal K chart sources…</p>
      {:else if chartsLoadState === 'error'}
        <div class="load-note" role="alert">
          <p class="muted-note">
            Could not load Signal K chart sources. Saved URL charts remain available.
          </p>
          {#if onRetryCharts}
            <button type="button" class="btn" onclick={onRetryCharts}>
              <RefreshCw size={16} aria-hidden="true" />
              Retry
            </button>
          {/if}
        </div>
      {:else if chartsLoadState === 'partial'}
        <div class="load-note" role="alert">
          <p class="muted-note">Some Signal K chart sources could not be opened.</p>
          {#if onRetryCharts}
            <button type="button" class="btn" onclick={onRetryCharts}>
              <RefreshCw size={16} aria-hidden="true" />
              Retry
            </button>
          {/if}
        </div>
      {/if}
      <section class="category" aria-label="Chart sources">
        <h3 class="category-head pinned-head">
          <span class="category-title caps-label">Chart sources</span>
          <span class="category-count" aria-hidden="true">{chartRows.length}</span>
        </h3>
        {#if chartRows.length === 0}
          <p class="muted-note empty-note">No chart sources yet.</p>
        {:else}
          <ul class="category-rows bare-list chart-source-rows">
            {#each chartRows as { item, i } (item.id)}
              <LayerRow
                {item}
                {view}
                index={i}
                count={movable.length}
                groupTitle={item.group?.title}
                subLayers={childrenByParent.get(item.id) ?? []}
                dragging={false}
                dropBefore={false}
                dropAfter={false}
                draggable={false}
                onHandlePointerDown={() => {}}
                onHandleKeydown={() => {}}
                manageLabel={item.chart ? `Open ${item.title} chart details` : undefined}
                onManage={item.chart
                  ? () => (detailId = item.id)
                  : undefined}
              />
            {/each}
          </ul>
        {/if}
      </section>

      {#if userCharts}
        <div class="add-chart-area">
          {#if addOpen}
            <AddChartForm
              {userCharts}
              writeBlocked={auth.writeBlocked}
              onDone={() => (addOpen = false)}
            />
          {:else}
            <button
              type="button"
              class="btn"
              onclick={() => (addOpen = true)}
              disabled={auth.writeBlocked}
            >
              <Plus size={16} aria-hidden="true" />
              Add a chart
            </button>
          {/if}
        </div>
      {/if}
    {:else if view.items.length === 0}
      <p class="muted-note">No overlays yet. Open a chart to fill this list.</p>
    {:else}
      {#if pinned.length > 0}
        <section class="category" aria-label="Always on top">
          <h3 class="category-head pinned-head">
            <span class="category-title caps-label">Always on top</span>
          </h3>
          <ul class="category-rows bare-list">
            {#each pinned as item (item.id)}
              <li class="list-row pinned-row">
                <span class="lead"><Lock class="pin-glyph" size={18} aria-hidden="true" /></span>
                <span class="title" title={item.title}>{item.title}</span>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <ul class="rows bare-list" bind:this={listEl}>
        {#each overlayCategories as cat (cat.id)}
          {@const expanded = isOpen(cat.id)}
          {@const panelId = `layer-cat-${cat.id}`}
          <li class="category">
            <h3 class="category-head">
              <button
                type="button"
                class="category-toggle row-interactive"
                aria-expanded={expanded}
                aria-controls={panelId}
                onclick={() => toggleCategory(cat.id)}
              >
                <ChevronRight
                  class={expanded ? 'chev chev-open' : 'chev'}
                  size={16}
                  aria-hidden="true"
                />
                <span class="category-title caps-label">{cat.title}</span>
                <span class="category-count" aria-hidden="true">{cat.rows.length}</span>
              </button>
            </h3>
            <ul class="category-rows bare-list" id={panelId} hidden={!expanded}>
              {#each cat.rows as { item, i } (item.id)}
                {@const indicator = reorder.indicatorFor(item.id)}
                <LayerRow
                  {item}
                  {view}
                  index={i}
                  count={movable.length}
                  groupTitle={item.group?.title}
                  subLayers={childrenByParent.get(item.id) ?? []}
                  dragging={reorder.dragId === item.id}
                  dropBefore={indicator.before}
                  dropAfter={indicator.after}
                  onHandlePointerDown={(e) => reorder.handlePointerDown(item.id, e)}
                  onHandleKeydown={(e) => reorder.handleKeydown(item.id, e)}
                  manageLabel={item.chart ? `Open ${item.title} chart details` : undefined}
                  onManage={item.chart
                    ? () => (detailId = item.id)
                    : item.manageable
                      ? () => onManageLayer?.(item.id)
                      : undefined}
                />
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</SlideOver>

<style>
.rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.layer-tabs {
  margin-block: var(--space-1) var(--space-2);
}
.layer-tabs .btn {
  flex: 1;
}
.load-note {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.load-note .muted-note {
  flex: 1 1 14rem;
}
/* A pinned, always-on layer (own vessel, MOB, active collision): the same flat row module as a normal
   layer, with a lock glyph in the lead rail instead of a drag handle (it cannot move or be hidden) and
   no toggle or opacity control. The lead reserves the same width as a layer row's handle so the titles
   share one column. */
.pinned-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.pinned-row .lead {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: var(--control-size);
  flex-shrink: 0;
}
.pinned-row :global(.pin-glyph) {
  color: var(--text-muted);
}
.pinned-row .title {
  flex: 1;
  min-inline-size: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--text-md);
  font-weight: 600;
}
.category {
  list-style: none;
}
.category-head {
  margin: 0;
}
/* The whole header is the disclosure control: a chevron that rotates open, the category title, and a
   count of the rows it holds. Its control-height chrome, hover tint, and transparent background come
   from the shared .row-interactive base in overlays.css; only the content layout is scoped here. */
.category-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-inline: var(--space-1);
  border-radius: var(--radius-sm);
}
.category-toggle :global(.chev) {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform var(--transition-fast);
}
.category-toggle :global(.chev-open) {
  transform: rotate(90deg);
}
.category-title {
  flex: 1;
  min-inline-size: 0;
  text-align: start;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.category-count {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.category-rows {
  margin: var(--space-1) 0 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.category-rows[hidden] {
  display: none;
}
/* The pinned section header is not collapsible, so it carries no chevron and no count, just the label
   at the same height and inset as the collapsible category headers. */
.pinned-head {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-block-size: var(--control-size);
  padding-inline: var(--space-1);
}
.empty-note {
  padding: 0 var(--space-1) var(--space-2);
}
.chart-source-rows {
  border-block-start: 1px solid var(--border);
}
.add-chart-area {
  margin-block-start: var(--space-2);
  padding-block-start: var(--space-2);
  border-block-start: 1px solid var(--border);
}
</style>

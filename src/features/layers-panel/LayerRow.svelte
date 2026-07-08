<script lang="ts">
import { GripVertical, RotateCcw, Settings2, SlidersHorizontal } from '@lucide/svelte';
import type { LayerListItem } from '$shared/map';
import { AnchoredMenu, LayerToggle, UnavailableHint } from '$shared/ui';
import type { LayersView } from './layers-view.svelte';

interface Props {
  item: LayerListItem;
  view: LayersView;
  index: number;
  count: number;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onHandlePointerDown: (event: PointerEvent) => void;
  onHandleKeydown: (event: KeyboardEvent) => void;
  // Present only on a user-imported chart row, which opens a detail (rename, info, delete).
  onManage?: () => void;
  // Sub-layers of this row (a chart facet, for example NOAA ENC data quality). When present, the row
  // renders as a facet group: one handle moves the group, the parent and child toggles share one
  // aligned column, and the tune control adjusts the whole group's opacity. Each child is a toggle
  // only, disabled while this row is off, so a facet never renders without the chart it annotates.
  subLayers?: LayerListItem[];
  // Set when this row is the top-level facet of a named group (NOAA ENC). The visible group title is
  // drawn by the panel above the card; here it names the listitem so a screen reader speaks the group
  // the row belongs to, since the visible title is decorative.
  groupTitle?: string;
}

const {
  item,
  view,
  index,
  count,
  dragging,
  dropBefore,
  dropAfter,
  onHandlePointerDown,
  onHandleKeydown,
  onManage,
  subLayers = [],
  groupTitle,
}: Props = $props();

// A layer at zero opacity while its toggle stays checked is a silent failure for safety layers
// (AIS, anchor ring), so the slider floor keeps them faintly visible.
const MIN_LAYER_OPACITY = 0.15;
const percent = $derived(Math.round(item.opacity * 100));
// The opacity control shows only when the layer is on and can be dimmed, and it lights when the layer
// is below full so a faded layer is visible at a glance without opening the popover.
const canTune = $derived(item.supportsOpacity && item.visible);
const dimmed = $derived(item.opacity < 1);
// A row only counts as a facet group when it actually has sub-layers nested under it: a row that
// merely shares a group id with something it is not the parent of (for example a plain sibling row
// tagged with the same group for display grouping alone) keeps its own title.
const isFacetGroup = $derived(subLayers.length > 0);
// The drag handle moves the whole row, so for a facet group it names the group, otherwise the layer.
const handleLabel = $derived(isFacetGroup ? (groupTitle ?? item.title) : item.title);

let tuneOpen = $state(false);
// Close the popover if the layer is hidden while it is open: the popover lives inside the canTune
// block, so without this re-showing the layer would pop it back open unprompted.
$effect(() => {
  if (!canTune) tuneOpen = false;
});
</script>

{#snippet dragHandle()}
  <button
    type="button"
    class="icon-btn handle"
    aria-label={`Move ${handleLabel}, position ${index + 1} of ${count}`}
    aria-keyshortcuts="ArrowUp ArrowDown"
    onpointerdown={onHandlePointerDown}
    onkeydown={onHandleKeydown}
  >
    <GripVertical size={18} aria-hidden="true" />
  </button>
{/snippet}

{#snippet trailing()}
  <div class="trail">
    {#if canTune}
      <div class="tune-anchor">
        <button
          type="button"
          class="icon-btn"
          class:icon-btn--accent={dimmed}
          aria-label={`Adjust ${item.title} opacity`}
          aria-haspopup="true"
          aria-expanded={tuneOpen}
          onclick={() => (tuneOpen = !tuneOpen)}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
        </button>
        <AnchoredMenu
          open={tuneOpen}
          onClose={() => (tuneOpen = false)}
          backdropLabel={`Close ${item.title} opacity`}
          ariaLabel={`${item.title} opacity`}
          surfaceClass="popover-card tune-pop"
        >
          <div class="tune-body">
            <input
              class="range"
              type="range"
              min={MIN_LAYER_OPACITY}
              max="1"
              step="0.05"
              value={item.opacity}
              aria-label={`${item.title} opacity`}
              oninput={(e) => view.setOpacity(item.id, Number(e.currentTarget.value))}
            >
            <span class="num tune-val">{percent}%</span>
            <button
              type="button"
              class="icon-btn"
              aria-label="Reset opacity"
              onclick={() => view.setOpacity(item.id, 1)}
            >
              <RotateCcw size={16} aria-hidden="true" />
            </button>
          </div>
        </AnchoredMenu>
      </div>
    {/if}
    {#if onManage}
      <button type="button" class="icon-btn" aria-label={`Manage ${item.title}`} onclick={onManage}>
        <Settings2 size={18} aria-hidden="true" />
      </button>
    {/if}
  </div>
{/snippet}

{#snippet regionTag()}
  {#if item.region}
    <span class="region-tag">{item.region}</span>
  {/if}
{/snippet}

<li
  class="list-row row reorder-row"
  class:dragging
  class:drop-before={dropBefore}
  class:drop-after={dropAfter}
  class:unavailable={!item.available}
  aria-label={isFacetGroup ? groupTitle : undefined}
  title={item.available ? undefined : item.unavailableHint}
  data-layer-row={item.id}
>
  <UnavailableHint hint={item.available ? undefined : item.unavailableHint} />
  {#if isFacetGroup}
    <!-- A facet group: one handle moves the whole group, the parent and child toggles share one
         aligned column, and the tune control sits on the parent line. -->
    <div class="facet-row">
      <span class="lead">{@render dragHandle()}</span>
      <div class="facet-stack">
        <div class="facet-line">
          <LayerToggle
            title={item.title}
            description={item.description}
            visible={item.visible}
            onToggle={(visible) => view.toggle(item.id, visible)}
          />
          {@render regionTag()}
          {@render trailing()}
        </div>
        {#each subLayers as sub (sub.id)}
          <div class="facet-line facet-child">
            <LayerToggle
              title={sub.title}
              description={sub.description}
              visible={sub.visible}
              disabled={!item.visible}
              onToggle={(visible) => view.toggle(sub.id, visible)}
            />
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="row-main">
      <span class="lead">{@render dragHandle()}</span>
      <LayerToggle
        title={item.title}
        description={item.description}
        visible={item.visible}
        disabled={!item.available}
        onToggle={(visible) => view.toggle(item.id, visible)}
      />
      {@render regionTag()}
      {@render trailing()}
    </div>
  {/if}
</li>

<style>
/* Flat list row: no card border or fill, a hairline divider draws between rows in the panel. The whole
   row is one module, a lead rail (drag handle), the toggle and title in the flexible center, and a
   trailing rail (tune, manage), so every row reads on the same two rails down the panel. */
/* The flat-row skeleton (height, padding, divider) comes from the shared .list-row, and the drag
   feedback (positioning context, the dragging lift, the drop indicators, the grip rest and lift)
   from the shared .reorder-row. Only the layer-specific states stay here. */
.row-main,
.facet-line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-block-size: var(--control-size);
}
/* The lead rail reserves the handle's width so rows never reflow when the quiet handle lifts on hover.
   The handle is muted at rest and lifts to full on row hover or keyboard focus, so 25 grips do not
   shout, while staying faintly present (and tappable) for touch. */
.lead {
  display: inline-flex;
  flex-shrink: 0;
}
.trail {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-inline-start: auto;
  flex-shrink: 0;
}
.tune-anchor {
  position: relative;
  display: inline-flex;
}
/* The opacity popover, anchored under the tune button at the row's trailing edge. The floating-card
   frame comes from the shared .popover-card; this only positions and sizes it. */
.tune-anchor :global(.tune-pop) {
  position: absolute;
  inset-block-start: calc(100% + var(--space-1));
  inset-inline-end: 0;
  z-index: var(--z-menu);
  inline-size: 14rem;
  max-inline-size: min(14rem, 70vw);
  padding: var(--space-2);
  transform-origin: top right;
}
.tune-body {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.tune-body .range {
  flex: 1;
  min-inline-size: 0;
}
.tune-val {
  min-inline-size: 2.6rem;
  text-align: end;
  color: var(--text-muted);
}
/* A facet group: the handle is a left gutter top-aligned with the first facet, the facets stack to its
   right so every toggle's checkbox shares one left edge, and a child facet is inset under its parent. */
.facet-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-block-size: var(--control-size);
}
.facet-row .lead {
  min-block-size: var(--control-size);
  align-items: center;
}
.facet-stack {
  flex: 1;
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
}
.facet-child {
  /* A nested child toggle is secondary, so it runs at the denser row-size line rather than the full
     control-size of a primary row, indented under the parent's title column. */
  min-block-size: var(--row-size);
  padding-inline-start: var(--space-3);
}
/* The region tag: a quiet bordered pill (US, EU, Global) so a navigator sees at a glance which waters an
   overlay covers. It is metadata, not a control, so it stays muted and sits before the action rail. */
.region-tag {
  flex-shrink: 0;
  align-self: center;
  padding-inline: var(--space-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1.7;
}
</style>

<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import type { LayerListItem } from '$shared/map';
import { AnchoredMenu, rovingFocus } from '$shared/ui';

interface Props {
  // Driven by the parent rather than a conditional mount, so AnchoredMenu owns the open transition
  // and the gated dismiss registration, matching the StatusStrip More menu.
  open: boolean;
  // The mutually-exclusive area fills (the LayerManager enforces one-at-a-time) and the freely
  // combinable overlays, already split by the parent.
  fills: LayerListItem[];
  overlays: LayerListItem[];
  // The source and fetch-age line, surfaced in the menu too so it is not hidden behind a click;
  // undefined before any grid loads.
  provenance: string | undefined;
  onToggle: (id: string, next: boolean) => void;
  onClose: () => void;
}

const { open, fills, overlays, provenance, onToggle, onClose }: Props = $props();

const groups = $derived(
  [
    { label: 'Area fill', items: fills },
    { label: 'Overlays', items: overlays },
  ].filter((group) => group.items.length > 0),
);
</script>

<!-- AnchoredMenu owns the backdrop dismiss, gated registerDismiss, and the grow transition.
     surfaceClass positions the surface inside .panel-map; no position: relative or container-type
     is added to the surface element so the @container query below resolves against .panel-map. -->
<AnchoredMenu
  {open}
  {onClose}
  backdropLabel="Close weather layers"
  surfaceClass="popover-card weather-menu"
  ariaLabel="Weather layers"
  id="weather-layer-menu"
  onFocusLeft={onClose}
>
  <!-- Non-modal on purpose: a toolbar dropdown over the map, not a modal. No focus trap, so Tab can
         leave into the map and footer; do not "correct" this into a focusTrap. rovingFocus lands the
         keyboard on the first row and moves it with the arrow keys. -->
  <div class="rows" use:rovingFocus={'.menu-row'}>
    {#each groups as group (group.label)}
      <p class="caps-label">{group.label}</p>
      {#each group.items as item (item.id)}
        <button
          type="button"
          class="menu-row row-interactive"
          class:is-on={item.visible}
          aria-pressed={item.visible}
          aria-describedby={item.description ? `${item.id}-weather-description` : undefined}
          title={item.description ?? item.title}
          onclick={() => onToggle(item.id, !item.visible)}
        >
          <span>{item.title}</span>
          {#if item.visible}
            <Check size={16} aria-hidden="true" />
          {/if}
        </button>
        {#if item.description}
          <span id={`${item.id}-weather-description`} class="visually-hidden"
            >{item.description}</span
          >
        {/if}
      {/each}
    {/each}
    {#if provenance}
      <p class="provenance muted-note">{provenance}</p>
    {/if}
  </div>
</AnchoredMenu>

<style>
/* Anchored under the floating trigger (which sits at --space-2 and is one --control-size tall),
   scrolling inside its own box so it grows down the list rather than along the header. */
:global(.weather-menu) {
  position: absolute;
  z-index: var(--z-menu);
  inset-block-start: calc(var(--space-2) + var(--control-size) + var(--space-1));
  inset-inline-start: var(--space-2);
  inline-size: 15rem;
  max-inline-size: calc(100cqw - 2 * var(--space-2));
  max-block-size: min(60vh, 24rem);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: var(--space-2);
}
/* The roving-focus host is transparent to layout so the rows stay direct flex children of the
   surface and keep the surface's row gap; it adds no box, no container, and no containing block. */
.rows {
  display: contents;
}
:global(.weather-menu) .caps-label {
  margin: var(--space-1) 0 0.1rem;
}
:global(.weather-menu) .caps-label:first-child {
  margin-block-start: 0;
}
/* The row chrome, hover tint, and lit (.is-on) body come from the shared .row-interactive base in
   overlays.css: the lit on-state reads accent-on-near-black by brightness, so it holds in night-red
   where hue barely separates, and the trailing check is the redundant shape cue. The 1px border-width
   reserves space for the lit accent border (whose color the base owns); only the content layout and
   the smaller type are scoped here. */
.menu-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 0 0.6rem;
  border-width: 1px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  text-align: start;
}
.provenance {
  margin: var(--space-1) 0 0;
  padding: 0 0.6rem;
}
/* On a narrow weather panel (not a narrow viewport: the panel is min(94vw, 46rem) and can be narrow
   on a wide screen), dock the card to the bottom of the map as a sheet instead of covering the
   small map from the top. Keyed off the panel-map container width, set by the parent. */
@container (max-width: 26rem) {
  :global(.weather-menu) {
    inset-block: auto var(--space-2);
    inset-inline: var(--space-2);
    inline-size: auto;
    max-inline-size: none;
    max-block-size: min(50vh, 18rem);
    transform-origin: bottom center;
  }
}
</style>

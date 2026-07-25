<script module lang="ts">
let nextDisclosureId = 0;
</script>

<script lang="ts">
import ChevronRight from '@lucide/svelte/icons/chevron-right';
import type { Snippet } from 'svelte';

// A labeled collapsible section: a chevron toggle over content that stays in the DOM (hidden) when
// closed. The shared reveal for every "Customize" and "Advanced" affordance, so the chevron, the
// aria wiring, and the spacing read the same as the Layers-panel categories.
interface Props {
  label: string;
  expanded?: boolean;
  children: Snippet;
}

let { label, expanded = $bindable(false), children }: Props = $props();
const panelId = `disclosure-${nextDisclosureId++}`;
</script>

<div class="disclosure">
  <button
    type="button"
    class="disclosure-toggle row-interactive"
    aria-expanded={expanded}
    aria-controls={panelId}
    onclick={() => (expanded = !expanded)}
  >
    <ChevronRight
      class="disclosure-chevron {expanded ? 'is-open' : ''}"
      size={18}
      aria-hidden="true"
    />
    <span class="disclosure-label">{label}</span>
  </button>
  <div class="disclosure-body" id={panelId} hidden={!expanded}>
    {@render children()}
  </div>
</div>

<style>
.disclosure-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
  min-block-size: var(--row-size);
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.disclosure-label {
  flex: 1;
  text-align: start;
}
.disclosure-toggle :global(.disclosure-chevron) {
  flex-shrink: 0;
  transition: rotate var(--transition-fast);
}
.disclosure-toggle :global(.disclosure-chevron.is-open) {
  rotate: 90deg;
}
/* Default to display:none so the `hidden` attribute actually hides the body. A bare
   `display: flex` would override the hidden attribute's UA `display: none`, leaving the content
   always visible and the chevron looking inert. */
.disclosure-body {
  display: none;
  flex-direction: column;
  gap: var(--space-2);
  padding-block-start: var(--space-2);
}
.disclosure-body:not([hidden]) {
  display: flex;
}
</style>

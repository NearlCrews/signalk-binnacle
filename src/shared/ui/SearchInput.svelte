<script lang="ts">
import X from '@lucide/svelte/icons/x';
import { registerDismiss } from './dialog';

interface Props {
  // The query text. Bindable, so a panel keeps owning its own filter state.
  value: string;
  placeholder: string;
  // The accessible name of the field, which names what a query is matched against.
  ariaLabel: string;
  // The accessible name of the clear control; defaults to a generic one.
  clearLabel?: string;
}

let {
  value = $bindable(),
  placeholder,
  ariaLabel,
  clearLabel = 'Clear the search',
}: Props = $props();

let input = $state<HTMLInputElement>();
let focused = $state(false);

// Escape belongs to the field only while it is focused with something to clear; the shared dismiss
// stack puts this entry above the panel's own, so one Escape clears the query and a second closes
// the panel. Registering only while focused keeps Escape elsewhere in the panel closing the panel.
$effect(() => {
  if (!focused || value === '') return;
  return registerDismiss(() => {
    value = '';
  });
});

function clear(): void {
  value = '';
  input?.focus();
}
</script>

<!-- The panel search field: the full-width .input box plus a control-size clear button, because the
     native type="search" decoration is a small unthemed target in Chromium and WebKit and is absent
     in Firefox entirely. forms.css suppresses that decoration so only one clear control shows. -->
<div class="search-field">
  <input
    bind:this={input}
    bind:value
    class="input search-input"
    type="search"
    {placeholder}
    aria-label={ariaLabel}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
  >
  {#if value !== ''}
    <button type="button" class="icon-btn search-clear" aria-label={clearLabel} onclick={clear}>
      <X size={18} aria-hidden="true" />
    </button>
  {/if}
</div>

<style>
.search-field {
  position: relative;
  display: flex;
  align-items: center;
}
/* Reserve the clear button's square at the trailing edge so a long query never runs under it. The
   button overlays the box rather than sitting beside it, keeping the field its full panel width. */
.search-field .search-input {
  padding-inline-end: var(--control-size);
}
.search-clear {
  position: absolute;
  inset-inline-end: 0;
}
</style>

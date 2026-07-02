<script lang="ts">
import { HardDrive, TriangleAlert, Unplug } from '@lucide/svelte';
import type { CompanionState } from '$features/prewarm';
import { formatBytes } from '$shared/lib';

let {
  present,
  state,
  cacheBytes,
  onOpen,
}: {
  present: boolean;
  state: CompanionState;
  cacheBytes: number | null;
  onOpen: () => void;
} = $props();

// The offline-charts status pill sits in the right-hand controls beside the profile pill and opens the
// Offline charts panel on tap. It carries the state as a plain word ("online", "offline", "error") so
// the meaning never rides on the icon hue alone (WCAG 1.4.1); the icon carries the reinforcing color.
// serving and needs-auth both read "online": the companion is present and reachable either way, and the
// cache figure (only readable with access) lives in the hover title, never in the visible pill.
const word = $derived(state === 'offline' ? 'offline' : state === 'error' ? 'error' : 'online');
const Icon = $derived(state === 'offline' ? Unplug : state === 'error' ? TriangleAlert : HardDrive);
const bytes = $derived(formatBytes(cacheBytes ?? 0));
const title = $derived.by(() => {
  if (state === 'serving') return `Offline charts: online, cache ${bytes.value} ${bytes.unit}`;
  if (state === 'needs-auth') return 'Offline charts: online, sign in to see cache size';
  if (state === 'offline') return 'Offline charts: not responding';
  return 'Offline charts: server error';
});
const ariaLabel = $derived(`Chart Locker ${word}, open offline charts`);
</script>

{#if present}
  <button
    type="button"
    class="btn btn-pill cl-status"
    class:cl--offline={state === 'offline'}
    class:cl--error={state === 'error'}
    aria-label={ariaLabel}
    {title}
    onclick={() => {
      if (present) onOpen();
    }}
  >
    <Icon size={16} aria-hidden="true" />
    <span class="cl-brand">Chart Locker:</span>
    <span class="cl-state">{word}</span>
  </button>
{/if}

<style>
/* The base look is the shared global .btn .btn-pill. Only the per-state accent is pill-specific: it
   drives the icon hue always, and the state word only when it warns (offline or error), so the healthy
   "online" word stays the calm base text and the icon alone carries the ok hue. Single source for the
   accent through --chip-accent, defaulting to the ok token, overridden by the two warning modifiers. */
.cl-status {
  --chip-accent: var(--ok);
}
.cl-status.cl--offline {
  --chip-accent: var(--warning);
}
.cl-status.cl--error {
  --chip-accent: var(--alarm);
}
/* :global because the icon is the lucide svg, a child component Svelte's scoped selector does not tag. */
.cl-status :global(svg) {
  color: var(--chip-accent);
}
.cl-brand {
  color: var(--text-muted);
}
/* Only the warning states tint the word; online keeps the base text so the dim night-red ok token is
   never used as small body text (it reads too faint), letting the icon carry the healthy hue instead. */
.cl-status.cl--offline .cl-state,
.cl-status.cl--error .cl-state {
  color: var(--chip-accent);
}
/* On a phone the pill drops the "Chart Locker:" brand but keeps the icon and the state word, so a
   glance still reads offline or error; it stays a full tap target into the Offline charts panel. */
@media (max-width: 600px) {
  .cl-brand {
    display: none;
  }
}
</style>

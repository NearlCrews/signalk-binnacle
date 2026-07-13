<script lang="ts">
import { Check, KeyRound, TriangleAlert, Unplug } from '@lucide/svelte';
import type { CompanionState } from '$features/prewarm';
import { formatBytes } from '$shared/lib';

let {
  present,
  state,
  cacheBytes,
  accessUrl,
  onOpen,
}: {
  present: boolean;
  state: CompanionState;
  cacheBytes: number | null;
  accessUrl: string;
  onOpen: () => void;
} = $props();

// This status reports what is actually known, not a broad safety assurance. A successful health poll
// exposes the amount cached, while access, transport, and server failures stay distinct in visible text
// and icon shape. It does not claim a particular passage is ready; saved-area readiness lives in the
// Offline charts panel where it can be verified against coverage and update time.
const STATE_META: Record<CompanionState, { label: string; icon: typeof Check }> = {
  serving: { label: 'cached', icon: Check },
  'needs-auth': { label: 'admin sign-in', icon: KeyRound },
  offline: { label: 'unavailable', icon: Unplug },
  error: { label: 'error', icon: TriangleAlert },
};
const StateIcon = $derived(STATE_META[state].icon);
const visibleValue = $derived.by(() => {
  if (state !== 'serving') return STATE_META[state].label;
  if (cacheBytes === null) return 'cache ready';
  const bytes = formatBytes(cacheBytes);
  return `${bytes.value} ${bytes.unit}`;
});
const title = $derived.by(() => {
  if (state === 'serving') {
    const bytes = formatBytes(cacheBytes ?? 0);
    return `Offline charts: online, cache ${bytes.value} ${bytes.unit}`;
  }
  if (state === 'needs-auth') {
    return 'Offline charts: sign in to Signal K as an administrator, then return to Binnacle';
  }
  if (state === 'offline') return 'Offline charts: not responding';
  return 'Offline charts: server error';
});
const actionLabel = $derived(
  state === 'needs-auth' ? 'open Signal K administrator sign-in' : 'open offline charts',
);
const ariaLabel = $derived(`Offline charts, ${visibleValue}, ${actionLabel}`);
</script>

{#snippet content()}
  <span class="cl-state-mark"><StateIcon size={16} aria-hidden="true" /></span>
  <span class="cl-brand">Offline:</span>
  <span class="cl-value">{visibleValue}</span>
{/snippet}

{#if present}
  {#if state === 'needs-auth'}
    <a
      class="btn btn-pill cl-status cl--access"
      href={accessUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      {title}
    >
      {@render content()}
    </a>
  {:else}
    <button
      type="button"
      class="btn btn-pill cl-status"
      class:cl--offline={state === 'offline'}
      class:cl--error={state === 'error'}
      aria-label={ariaLabel}
      {title}
      onclick={onOpen}
    >
      {@render content()}
    </button>
  {/if}
{/if}

<style>
/* The base look is the shared global .btn .btn-pill. The icon carries the health accent, while the
   visible text says what is known on both pointer and touch devices. */
.cl-status {
  --chip-accent: var(--ok);
  flex: none;
  min-inline-size: var(--control-size);
  text-decoration: none;
}
.cl-status.cl--offline,
.cl-status.cl--access {
  --chip-accent: var(--warning);
}
.cl-status.cl--error {
  --chip-accent: var(--alarm);
}
.cl-state-mark :global(svg) {
  color: var(--chip-accent);
}
.cl-brand {
  color: var(--text-muted);
}
.cl-value {
  white-space: nowrap;
}
/* On a phone, "Offline:" is redundant with the persistent download-and-state icon. Keep the truthful
   cache or failure value visible instead of collapsing the control to an ambiguous glyph. */
@media (max-width: 600px) {
  .cl-brand,
  .cl-value {
    display: none;
  }
}
</style>

<script lang="ts">
import { Check, HardDrive, TriangleAlert, Unplug } from '@lucide/svelte';
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
// Offline charts panel on tap. A steady drive glyph marks the subsystem; the state shows as a second
// glyph (a check when online, a pulled plug when offline, a warning triangle on error) rather than a
// word, so it reads at a glance. The state never rides on hue alone: the three glyph shapes are
// distinct (this matters under night-red, where the accent tokens are three close reds), and the
// literal word stays in the aria-label and the hover title for screen-reader, voice, and touch users.
// serving and needs-auth both read online: the companion is present and reachable either way, and the
// cache figure (only readable with access) lives in the title, never in the visible pill.
const STATE_META: Record<CompanionState, { word: string; icon: typeof Check }> = {
  serving: { word: 'online', icon: Check },
  'needs-auth': { word: 'online', icon: Check },
  offline: { word: 'offline', icon: Unplug },
  error: { word: 'error', icon: TriangleAlert },
};
const word = $derived(STATE_META[state].word);
const StateIcon = $derived(STATE_META[state].icon);
const title = $derived.by(() => {
  if (state === 'serving') {
    const bytes = formatBytes(cacheBytes ?? 0);
    return `Offline charts: online, cache ${bytes.value} ${bytes.unit}`;
  }
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
    onclick={onOpen}
  >
    <span class="cl-brand-mark"><HardDrive size={16} aria-hidden="true" /></span>
    <span class="cl-brand">Chart Locker:</span>
    <span class="cl-state-mark"><StateIcon size={16} aria-hidden="true" /></span>
  </button>
{/if}

<style>
/* The base look is the shared global .btn .btn-pill. The leading drive glyph is a steady subsystem mark
   in the muted text color; only the trailing state glyph takes the per-state accent, so a glance reads
   which subsystem then what state. min-inline-size keeps a comfortable tap target when the label drops
   on a phone and only the two glyphs remain. */
.cl-status {
  --chip-accent: var(--ok);
  min-inline-size: 3rem;
}
.cl-status.cl--offline {
  --chip-accent: var(--warning);
}
.cl-status.cl--error {
  --chip-accent: var(--alarm);
}
/* :global because the icons are lucide child-component svgs the scoped selector does not tag. The brand
   mark stays muted; the state mark carries the accent. */
.cl-brand-mark :global(svg) {
  color: var(--text-muted);
}
.cl-state-mark :global(svg) {
  color: var(--chip-accent);
}
.cl-brand {
  color: var(--text-muted);
}
/* On a phone the pill drops the "Chart Locker:" label but keeps both glyphs, so a glance still reads the
   subsystem and its state; it stays a full tap target into the Offline charts panel. */
@container shell (max-width: 600px) {
  .cl-brand {
    display: none;
  }
}
</style>

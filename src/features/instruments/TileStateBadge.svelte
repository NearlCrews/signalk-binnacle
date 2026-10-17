<script lang="ts">
import type { ZoneState } from '$shared/signalk';
import type { TileValueState } from './tile-catalog';

interface Props {
  state: TileValueState;
  zone: ZoneState;
  // The wind tile's separate angle freshness, folded into this one badge line so a tile never
  // stacks two whispered state fragments.
  angleState?: 'stale' | 'unavailable';
}

const { state, zone, angleState }: Props = $props();

// Alarm outranks everything; Stale outranks Warning, since a zone verdict computed from an
// untrusted value is not a live warning; the angle-only states show only when nothing louder does.
const label = $derived(
  zone === 'alarm'
    ? 'Alarm'
    : state === 'stale'
      ? 'Stale'
      : zone === 'warning'
        ? 'Warning'
        : angleState === 'stale'
          ? 'Angle stale'
          : angleState === 'unavailable'
            ? 'Angle unavailable'
            : '',
);
// The chip colors itself by what it SAYS, not by the tile's zone class, so a Stale chip stays
// caution-amber even inside a warning-tinted tile.
const grade = $derived(
  label === 'Alarm' ? 'alarm' : label === 'Angle unavailable' ? 'neutral' : 'caution',
);
</script>

<!-- The badge's line is held while the tile is calm, so a state appearing never moves the tile's
     numeral: the tile centers the same content block either way. -->
{#if label}
  <span
    class="badge badge--caps"
    class:badge--alarm={grade === 'alarm'}
    class:badge--warning={grade === 'caution'}
    >{label}</span
  >
{:else}
  <span class="badge badge--caps badge-slot" aria-hidden="true">&nbsp;</span>
{/if}

<style>
.badge-slot {
  visibility: hidden;
}
</style>

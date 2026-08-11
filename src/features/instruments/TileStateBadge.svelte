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

{#if label}
  <span
    class="tile-state caps-label"
    class:tile-state--alarm={grade === 'alarm'}
    class:tile-state--caution={grade === 'caution'}
    >{label}</span
  >
{/if}

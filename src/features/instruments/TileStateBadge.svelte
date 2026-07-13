<script lang="ts">
import type { ZoneState } from '$shared/signalk';
import type { TileValueState } from './tile-catalog';

const { state, zone }: { state: TileValueState; zone: ZoneState } = $props();
const label = $derived(
  zone === 'alarm' ? 'Alarm' : zone === 'warning' ? 'Warning' : state === 'stale' ? 'Stale' : '',
);
</script>

{#if label}
  <span class="tile-state caps-label">{label}</span>
{/if}

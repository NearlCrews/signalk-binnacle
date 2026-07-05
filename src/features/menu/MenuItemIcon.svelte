<script lang="ts">
import { TriangleAlert } from '@lucide/svelte';
import type { MenuItem } from './menu-item';

interface Props {
  item: MenuItem;
  size: number;
}

const { item, size }: Props = $props();
</script>

<!-- One icon treatment for every menu surface (menu tiles, bar pills, overflow rows): the
     unavailable triangle replaces the action's icon, except on a lit pill where the pressed state
     already tells the story. -->
{#if item.available === false && item.pressed !== true}
  <TriangleAlert {size} aria-hidden="true" />
{:else if item.icon}
  {@const Icon = item.icon}
  <Icon {size} aria-hidden="true" />
{/if}

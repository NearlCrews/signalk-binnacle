<script lang="ts">
import { countBadge, countSuffix, type MenuItem } from './menu-item';

interface Props {
  item: MenuItem;
  hideBadge?: boolean;
}

const { item, hideBadge = false }: Props = $props();

const badge = $derived(countBadge(item));
const spoken = $derived(countSuffix(item));
</script>

<!-- One count treatment for every menu surface (menu tiles, bar pills, overflow rows), following
     MenuItemIcon. The chip is hidden from assistive tech and the spoken suffix follows the label
     instead, so a screen reader hears "Alarms, 3 active alarms" rather than a bare number run onto
     the label. The chip caps at 99+ to protect the pill's width; the spoken count stays exact. -->
{#if badge !== undefined}
  {#if !hideBadge}
    <span class="pill-count" aria-hidden="true">{badge}</span>
  {/if}
  <span class="visually-hidden">{spoken}</span>
{/if}

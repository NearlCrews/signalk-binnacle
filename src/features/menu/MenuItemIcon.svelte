<script lang="ts">
import Puzzle from '@lucide/svelte/icons/puzzle';
import type { MenuItem } from './menu-item';

interface Props {
  item: MenuItem;
  size: number;
}

const { item, size }: Props = $props();

// A quarter of the host icon, floored so it stays legible at the smallest (16px bar-pill) size.
const badgeSize = $derived(Math.max(9, Math.round(size * 0.45)));
</script>

<!-- One icon treatment for every menu surface (menu tiles, bar pills, overflow rows): an
     unavailable item keeps its own icon (grayed by the caller) so it still reads as itself, plus a
     small corner badge marking it as an add-on, never a warning triangle, which reads as "broken"
     rather than "install a plugin." -->
<span class="menu-item-icon">
  {#if item.icon}
    {@const Icon = item.icon}
    <Icon {size} aria-hidden="true" />
  {/if}
  {#if item.available === false}
    <Puzzle size={badgeSize} aria-hidden="true" class="menu-item-icon__badge" />
  {/if}
</span>

<style>
.menu-item-icon {
  position: relative;
  display: inline-flex;
}
/* The host icon and label are grayed by the tile's own opacity (not just its muted color), so the
   badge needs a color, not just a position, distinct enough to still read once that opacity applies;
   --text-muted here would fade to the same illegible smudge as the icon it's meant to stand apart
   from. --accent survives the dimming as a distinct hue against the muted gray around it. */
:global(.menu-item-icon__badge) {
  position: absolute;
  inset-block-end: -15%;
  inset-inline-end: -25%;
  color: var(--accent);
}
</style>

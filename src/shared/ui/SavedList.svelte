<script lang="ts" generics="T">
import type { Snippet } from 'svelte';

interface Props {
  // The caps-label heading above the list. Omit to let the parent own the heading.
  heading?: string;
  items: T[];
  // The message shown in place of the list when there are no items.
  empty: string;
  ariaLabel?: string;
  // The stable identity per item, so the keyed each reconciles cards in place across reorders.
  key: (item: T) => string;
  // Marks an item's card as the active one (an accent bar, border, and tint), when supplied.
  isActive?: (item: T) => boolean;
  // Renders one item's card body. The list owns the wrapper, the panel owns the contents.
  card: Snippet<[T]>;
}

const { heading, items, empty, ariaLabel, key, isActive, card }: Props = $props();

// The list names itself from its own heading when the caller supplies neither an ariaLabel nor a
// heading-less layout: no consumer passed ariaLabel, which left every shipped list's ul unnamed.
const headingId = $props.id();
</script>

<div class="saved">
  {#if heading}
    <span class="caps-label" id={headingId}>{heading}</span>
  {/if}
  {#if items.length === 0}
    <p class="empty">{empty}</p>
  {:else}
    <ul
      class="bare-list"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : heading ? headingId : undefined}
    >
      {#each items as item (key(item))}
        <li
          class="card-frame"
          class:active={isActive?.(item)}
          aria-current={isActive?.(item) ? 'true' : undefined}
        >
          {@render card(item)}
        </li>
      {/each}
    </ul>
  {/if}
</div>

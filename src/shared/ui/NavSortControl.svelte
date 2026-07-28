<script lang="ts" generics="K extends string">
import type { NavSortState } from '$shared/nav';

interface Props {
  // The sort keys this list offers, in display order.
  sorts: readonly { key: K; label: string }[];
  state: NavSortState<K>;
  onChoose: (key: K) => void;
  // Names the group for a screen reader, since "Sort by" alone does not say what is sorted.
  ariaLabel: string;
}

const { sorts, state, onChoose, ariaLabel }: Props = $props();
</script>

<div class="nav-sort">
  <span class="caps-label">Sort by</span>
  <div class="segmented" role="group" aria-label={ariaLabel}>
    {#each sorts as option (option.key)}
      <button
        type="button"
        class="btn"
        class:is-on={state.key === option.key}
        aria-pressed={state.key === option.key}
        onclick={() => onChoose(option.key)}
      >
        {option.label}
        {#if state.key === option.key}
          <span aria-hidden="true">{state.dir === 'asc' ? '▲' : '▼'}</span>
          <span class="visually-hidden">
            {state.dir === 'asc' ? 'ascending' : 'descending'}
          </span>
        {/if}
      </button>
    {/each}
  </div>
</div>

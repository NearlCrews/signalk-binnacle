<script lang="ts">
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import { ErrorBoundary } from '$shared/ui';
import PoiSearchPanel from './PoiSearchPanel.svelte';
import type { Poi } from './poi-search-rows';

let notes = $state.raw<Poi[]>([]);
let shown = $state(true);
let opened = $state(false);
const pois = $derived.by(() => {
  if (!opened) return [];
  return notes.filter(() => true).map((note) => ({ ...note }));
});
const loaded = Promise.resolve(PoiSearchPanel);

export function setNotes(next: Poi[]): void {
  notes = next;
}
export function open(): void {
  opened = true;
}
function toggle(value: boolean): void {
  shown = value;
  if (!value) notes = [];
}
</script>

{#if opened}
  {#await loaded then Panel}
    <ErrorBoundary>
      <Panel
        {pois}
        vessel={{ coarsePosition: undefined } as OwnVessel}
        units={{ mode: 'metric' } as UnitsStore}
        viewState={{ phase: 'ready', offline: false }}
        placesShown={shown}
        onTogglePlaces={toggle}
        onSelect={() => {}}
        onHover={() => {}}
        onClose={() => (opened = false)}
      />
      {#snippet fallback(error, _reset)}
        <p role="alert">{String(error)}</p>
      {/snippet}
    </ErrorBoundary>
  {/await}
{/if}

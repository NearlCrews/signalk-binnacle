<script lang="ts">
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import { formatBearingOr, formatSignedAngleOr } from '$shared/lib';
import { type AutopilotChipState, autopilotModeLabel } from './autopilot-controller.svelte';

// The compact helm-visible autopilot state, one data cell on the status strip's grid beside the
// other readouts. It renders nothing while no autopilot has ever answered: the panel's landing
// carries the discoverable explanation, so cell absence is the degrade. The cell is a door to the
// Autopilot panel, the anchor cell pattern, because engaged steering machinery deserves its
// commands one tap away rather than a note.

interface Props {
  chip: AutopilotChipState;
  onOpen: () => void;
  // The host's grid placement for the cell.
  cellClass?: string;
}

const { chip, onOpen, cellClass = '' }: Props = $props();

// An autopilot's compass target may be true or magnetic depending on the pilot, so the readout
// claims degrees only, never a T or M the API does not state. A wind target is a signed relative
// angle, port negative, which formatSignedAngleOr renders as P or S degrees.
const targetText = $derived.by(() => {
  if (chip.kind !== 'engaged' || chip.targetRad === null) return undefined;
  return chip.windMode
    ? `${formatSignedAngleOr(chip.targetRad)}°`
    : `${formatBearingOr(chip.targetRad)}°`;
});
const mode = $derived(
  chip.kind === 'engaged' && chip.mode !== null ? autopilotModeLabel(chip.mode) : undefined,
);
// One string, so the name and the mode cannot be split by a reflow into two spaces.
const label = $derived(mode === undefined ? 'AP' : `AP · ${mode}`);

const title = $derived.by(() => {
  switch (chip.kind) {
    case 'engaged':
      return 'Autopilot is steering; open the autopilot panel';
    case 'standby':
      return 'Autopilot is on standby; open the autopilot panel';
    case 'lost':
      return 'The autopilot provider stopped answering; open the autopilot panel';
    default:
      return '';
  }
});
</script>

{#if chip.kind !== 'hidden'}
  <button
    type="button"
    class="data-cell ap-cell {cellClass}"
    class:data-cell--warning={chip.kind === 'lost'}
    {title}
    onclick={onOpen}
  >
    <span class="data-cell-label">
      {#if chip.kind === 'lost'}
        <TriangleAlert size={12} aria-hidden="true" />
      {/if}
      {label}
    </span>
    <span class="data-cell-value">
      {#if chip.kind === 'engaged'}
        {#if targetText !== undefined}
          <b class="num">{targetText}</b>
        {:else}
          <span class="word">Steering</span>
        {/if}
      {:else if chip.kind === 'standby'}
        <span class="word">Standby</span>
      {:else}
        <span class="word" role="status" aria-live="polite">Unreachable</span>
      {/if}
    </span>
  </button>
{/if}

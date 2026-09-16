<script lang="ts">
import { formatBearingOr, formatSignedAngleOr } from '$shared/lib';
import { type AutopilotChipState, autopilotModeLabel } from './autopilot-controller.svelte';

// The compact helm-visible autopilot state, mounted in the status strip beside the other
// readouts. It renders nothing while no autopilot has ever answered: the panel's landing carries
// the discoverable explanation, so chip absence is the degrade. The chip is a door to the
// Autopilot panel, the anchor chip pattern, because engaged steering machinery deserves its
// commands one tap away rather than a note.

interface Props {
  chip: AutopilotChipState;
  onOpen: () => void;
}

const { chip, onOpen }: Props = $props();

// An autopilot's compass target may be true or magnetic depending on the pilot, so the readout
// claims degrees only, never a T or M the API does not state. A wind target is a signed relative
// angle, port negative, which formatSignedAngleOr renders as P or S degrees.
const targetText = $derived.by(() => {
  if (chip.kind !== 'engaged' || chip.targetRad === null) return undefined;
  return chip.windMode
    ? `${formatSignedAngleOr(chip.targetRad)}°`
    : `${formatBearingOr(chip.targetRad)}°`;
});

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
    class="ap-chip"
    class:sev-warning={chip.kind === 'lost'}
    {title}
    onclick={onOpen}
  >
    <span class="label">AP</span>
    {#if chip.kind === 'engaged'}
      {#if chip.mode !== null}
        <span>{autopilotModeLabel(chip.mode)}</span>
      {/if}
      {#if targetText !== undefined}
        <b class="num">{targetText}</b>
      {/if}
      {#if chip.mode === null && targetText === undefined}
        <span>Steering</span>
      {/if}
    {:else if chip.kind === 'standby'}
      <span>Standby</span>
    {:else}
      <span role="status" aria-live="polite">Unreachable</span>
    {/if}
  </button>
{/if}

<style>
/* Unlike explanation-only status chips, this opens steering controls and needs a full operational
   target. Keep the target in layout so neighboring readouts never overlap its hit area. */
.ap-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 0;
  background: none;
  padding: var(--space-2) var(--space-1);
  min-block-size: var(--control-size);
  min-inline-size: var(--control-size);
  font: inherit;
  font-size: var(--text-md);
  color: var(--text-muted);
  white-space: nowrap;
  cursor: pointer;
}
.label {
  font-weight: 600;
}
.ap-chip b {
  color: var(--text);
}
.ap-chip.sev-warning,
.ap-chip.sev-warning b {
  color: var(--warning);
}
</style>

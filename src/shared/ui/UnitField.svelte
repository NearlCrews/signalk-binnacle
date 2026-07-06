<script lang="ts">
import { tick } from 'svelte';

interface Props {
  label: string;
  unit?: string;
  // The effective value the field displays. After a commit the text snaps back to this, so a
  // caller that clamps or rejects an entry never leaves the input desynced from reality.
  value: number;
  min?: number;
  max?: number;
  step?: number | 'any';
  inputWidth?: string;
  ariaLabel?: string;
  // Grays out and blocks the input, for a field whose feature is currently switched off.
  disabled?: boolean;
  onCommit: (value: number) => void;
}

const {
  label,
  unit,
  value,
  min,
  max,
  step = 'any',
  inputWidth = '5.5rem',
  ariaLabel,
  disabled = false,
  onCommit,
}: Props = $props();

function commit(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  const entered = Number(input.value);
  if (Number.isFinite(entered)) onCommit(entered);
  // Snap the text back to the effective value after the caller has had its say.
  void tick().then(() => {
    input.value = String(value);
  });
}
</script>

<!-- The labeled number-input-with-unit row shared by the alarm thresholds, the anchor watch
     radius, and the route planning speed, so the field shape cannot drift per panel. -->
<label class="field" class:disabled>
  <span class="name">{label}</span>
  <input
    class="input"
    type="number"
    {min}
    {max}
    {step}
    {disabled}
    value={String(value)}
    aria-label={ariaLabel ?? (unit ? `${label} in ${unit}` : label)}
    style:inline-size={inputWidth}
    onchange={commit}
  >
  {#if unit}
    <span class="unit">{unit}</span>
  {/if}
</label>

<style>
.field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-block-size: var(--control-size);
}
.field.disabled {
  opacity: var(--disabled-opacity);
}
.name {
  flex: 1;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
/* The box comes from the shared .input primitive (44px tap target, raised fill); only the mono
   numerals, the width, and the accent are field-specific. */
.field input {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-md);
}
.unit {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
</style>

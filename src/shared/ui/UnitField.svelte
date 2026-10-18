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
  ariaDescribedBy?: string;
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
  ariaDescribedBy,
  disabled = false,
  onCommit,
}: Props = $props();

const errorId = $props.id();
let error = $state('');
const describedBy = $derived(
  [ariaDescribedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined,
);

function rejectedEntry(input: HTMLInputElement): string {
  if (!Number.isFinite(input.valueAsNumber)) return 'Enter a number.';
  if (input.validity.rangeUnderflow) return `Enter ${min} or more.`;
  if (input.validity.rangeOverflow) return `Enter ${max} or less.`;
  if (input.validity.stepMismatch)
    return `Use increments of ${step} starting at ${min ?? input.getAttribute('value') ?? 0}.`;
  return 'Enter a valid number.';
}

function commit(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  const entered = input.valueAsNumber;
  if (Number.isFinite(entered) && input.validity.valid) {
    error = '';
    onCommit(entered);
  } else {
    error = `${rejectedEntry(input)} Not changed; ${value}${unit ? ` ${unit}` : ''} remains active.`;
  }
  // Snap the text back to the effective value after the caller has had its say.
  void tick().then(() => {
    input.value = String(value);
  });
}
</script>

<!-- The labeled number-input-with-unit row shared by the alarm thresholds, the anchor watch
     radius, and the route planning speed, so the field shape cannot drift per panel. -->
<div class="unit-field">
  <label class="field-row" class:disabled>
    <span class="field-row-name">{label}</span>
    <input
      class="input"
      type="number"
      {min}
      {max}
      {step}
      {disabled}
      value={String(value)}
      aria-label={ariaLabel ?? (unit ? `${label} in ${unit}` : label)}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      style:inline-size={inputWidth}
      onchange={commit}
    >
    <span class="field-row-unit">{unit ?? ''}</span>
  </label>
  <p id={errorId} class="alert-note field-error" role="status" hidden={!error}>{error}</p>
</div>

<style>
.unit-field {
  min-inline-size: 0;
}
.field-error {
  margin-block: var(--space-1) 0;
}
/* The row comes from the shared .field-row; the box from the shared .input primitive (44px tap
   target, raised fill). Only the mono numerals and the width are field-specific. */
.field-row.disabled {
  opacity: var(--disabled-opacity);
}
.field-row input {
  max-inline-size: 100%;
  min-inline-size: 0;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-input-large);
}
</style>

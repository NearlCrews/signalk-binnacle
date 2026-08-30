<script lang="ts">
import { focusOnMountIf } from './focus';

interface Props {
  label: string;
  // The text the field shows. A controlled value: the parent owns it and updates it on commit.
  value: string;
  // 'inline' sets the label beside a growing input (the region name row); 'stacked' sets a caps
  // label above a full-width input (the chart name and description rows).
  variant?: 'inline' | 'stacked';
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  // Overrides the accessible name; left unset, the visible label names the input through the wrapping
  // label, so most callers can omit it.
  ariaLabel?: string;
  // One size above the default, for a field typed on a pitching deck (the waypoint name).
  large?: boolean;
  // Focus the input when it mounts, for a field revealed in place (an import review row, a dialog).
  focusOnOpen?: boolean;
  // The input type, for a field whose content deserves a specialized mobile keyboard (the chart
  // URL). Text-like types only; the field stays a controlled string either way.
  type?: 'text' | 'url';
  // Fired on the native change (a commit on blur or Enter), carrying the entered text.
  onCommit: (value: string) => void;
  // Fired on every keystroke, so a parent can validate live (disable a Save button while empty).
  onInput?: (value: string) => void;
  // Fired when Enter is pressed, for a field that submits its surrounding form or dialog.
  onEnter?: () => void;
}

const {
  label,
  value,
  variant = 'inline',
  placeholder,
  disabled = false,
  maxLength,
  ariaLabel,
  large = false,
  focusOnOpen = false,
  type = 'text',
  onCommit,
  onInput,
  onEnter,
}: Props = $props();

function commit(event: Event): void {
  onCommit((event.currentTarget as HTMLInputElement).value);
}
</script>

<!-- The labeled text-input row shared by the region name field and the chart name and description
     fields, so the labeled-text shape cannot drift per panel. The inline variant grows the input
     beside its label; the stacked variant sets a caps label above a card-width input. -->
<label class="text-field" class:stacked={variant === 'stacked'} class:large>
  <span class="name" class:caps-label={variant === 'stacked'}>{label}</span>
  <input
    class="input"
    {type}
    {value}
    {placeholder}
    {disabled}
    maxlength={maxLength}
    aria-label={ariaLabel}
    use:focusOnMountIf={focusOnOpen}
    onchange={commit}
    oninput={(event) => onInput?.((event.currentTarget as HTMLInputElement).value)}
    onkeydown={(event) => {
      if (onEnter && event.key === 'Enter') {
        event.preventDefault();
        onEnter();
      }
    }}
  >
</label>

<style>
.text-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-block-size: var(--control-size);
}
.text-field .name {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
/* The input box comes from the shared .input primitive; it grows to fill the inline row. */
.text-field .input {
  flex: 1;
  min-inline-size: 0;
}
/* Stacked: the caps label sits above a full-width input, for a card-width text row. */
.text-field.stacked {
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-1);
  min-block-size: 0;
}
.text-field.stacked .name {
  display: block;
}
.text-field.stacked .input {
  inline-size: 100%;
  box-sizing: border-box;
}
/* One step above the global .input font, for a single field typed gloved on a pitching deck. */
.text-field.large .input {
  font-size: var(--text-input-large);
}
</style>

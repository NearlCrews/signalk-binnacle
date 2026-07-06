<script lang="ts">
import { untrack } from 'svelte';
import { focusSelectOnMount } from './focus';

// An inline name form that replaces a native window.prompt: a labeled, themed text input with Save
// and Cancel, so naming a route, track, or profile reads like the rest of the app instead of an
// unstyled browser dialog. Enter saves, Escape cancels, and the seeded text starts selected so the
// navigator can type over the default name. The caller owns the trim and the default-name fallback.
interface Props {
  // The caps label above the input, doubling as the form's accessible name.
  label: string;
  // The initial text, typically a seeded default name. Starts selected for type-over.
  value?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const { label, value = '', confirmLabel = 'Save', onConfirm, onCancel }: Props = $props();

// Seed the editable text from the prop once: the form is freshly mounted per use, so it takes a
// snapshot of the default name rather than tracking the prop. untrack makes that one-time read
// explicit and keeps the compiler from flagging a missed reactive reference.
let text = $state(untrack(() => value));

function submit(event: SubmitEvent): void {
  event.preventDefault();
  onConfirm(text);
}
</script>

<form class="name-entry" aria-label={label} onsubmit={submit}>
  <label class="name-entry-field">
    <span class="caps-label">{label}</span>
    <input
      class="input"
      type="text"
      bind:value={text}
      use:focusSelectOnMount
      onkeydown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
  </label>
  <div class="panel-controls">
    <button type="submit" class="btn btn-primary">{confirmLabel}</button>
    <button type="button" class="btn" onclick={onCancel}>Cancel</button>
  </div>
</form>

<style>
.name-entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.name-entry-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
</style>

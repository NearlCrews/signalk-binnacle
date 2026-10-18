<script lang="ts">
interface Props {
  // The resting words and the confirm question that replaces them once armed (ConfirmArm owns the
  // armed state and its timeout).
  label: string;
  armedLabel: string;
  armed: boolean;
  tone: 'warning' | 'alarm';
  disabled?: boolean;
  onclick: () => void;
  onkeydown?: (event: KeyboardEvent) => void;
}

const { label, armedLabel, armed, tone, disabled = false, onclick, onkeydown }: Props = $props();
</script>

<!-- A strip's armed confirm: the words swap (Raise anchor, then Confirm raise?) while the button
     reserves the width of its other label, so arming changes only the words and never moves the
     button or its neighbors. The visible text is the whole accessible name, so a screen reader
     hears the confirm question once armed. -->
<button
  type="button"
  class="btn btn-pill btn-strip label-reserve btn-{tone}"
  data-reserve={armed ? label : armedLabel}
  {disabled}
  {onclick}
  {onkeydown}
>
  <span>{armed ? armedLabel : label}</span>
</button>

<script lang="ts">
interface Props {
  fraction: number | undefined;
  state?: 'normal' | 'warning' | 'alarm';
}

const { fraction, state = 'normal' }: Props = $props();

// Interior fill width. The body is inset 2 on every side (x from 3, height 8), leaving 30 units of
// travel across a 34-wide body; the fill scales that by the charge fraction, clamped to 0..1.
const fillWidth = $derived(fraction === undefined ? 0 : Math.max(0, Math.min(1, fraction)) * 30);

const fillColor = $derived(
  state === 'alarm' ? 'var(--alarm)' : state === 'warning' ? 'var(--warning)' : 'currentColor',
);
</script>

<svg class="battery" viewBox="0 0 36 14" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="34" height="12" rx="2" fill="none" stroke="currentColor" />
  <rect class="nub" x="34" y="4" width="2" height="6" fill="currentColor" />
  {#if fraction !== undefined}
    <rect class="fill" x="3" y="3" width={fillWidth} height="8" fill={fillColor} />
  {/if}
</svg>

<style>
.battery {
  inline-size: 2.25rem;
  block-size: auto;
  flex-shrink: 0;
}
</style>

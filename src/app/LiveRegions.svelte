<script lang="ts">
// The aria live regions. One assertive safety region, fed by the priority-aware annunciator so
// simultaneous hazards speak worst-first and a later low-priority notification can never
// interrupt an urgent announcement; one polite region drains the annunciator's queued secondary
// summaries; the mute note and the companion health note stay polite and separate. The
// .visually-hidden utility is global (src/styles/a11y.css), so no scoped style is needed here.
let {
  safety,
  safetyQueue,
  mute,
  companion,
}: {
  safety: string;
  safetyQueue: string;
  mute: string;
  companion: string;
} = $props();
</script>

<div class="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">
  {safety}
</div>
<div class="visually-hidden" aria-live="polite" aria-atomic="true">{safetyQueue}</div>
<div class="visually-hidden" aria-live="polite" aria-atomic="true">{mute}</div>
<div class="visually-hidden" aria-live="polite" aria-atomic="true">{companion}</div>

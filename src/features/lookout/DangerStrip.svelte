<script lang="ts">
import { vesselLabel } from '$entities/ais';
import type { CollisionAssessment } from '$entities/collision';
import { formatNm, formatTcpaMin } from '$shared/lib';

interface Props {
  collision: CollisionAssessment;
  // Whether the collision alarm sound is currently muted, and a handler to toggle it. Surfaced here
  // so silencing the alarm during a close-quarters situation is one tap, not a dive into the menu.
  muted: boolean;
  onToggleMute: () => void;
}

const { collision, muted, onToggleMute }: Props = $props();

const MAX_ROWS = 4;

const contacts = $derived(collision.assessment.contacts);
const unassessedCount = $derived(collision.assessment.unassessed.length);
const top = $derived(contacts.slice(0, MAX_ROWS));
const overflow = $derived(Math.max(0, contacts.length - MAX_ROWS));
const computedFallback = $derived(contacts.some((c) => c.source === 'computed'));
// Grade the strip by the worst contact (contacts[0] is severity-then-time sorted): a warning-only
// situation reads as caution, not the full alarm, so the strongest red is reserved for real danger.
const worstIsDanger = $derived(contacts[0]?.severity === 'danger');
// Acknowledged means the operator has seen it and silenced the sound, but the contact is still
// closing, so the strip stays on screen in a dimmed state with its CPA and TCPA visible rather than
// vanishing. An escalation past the inner ring un-dims it and restores the actions, since the alarm
// is sounding again regardless of the acknowledge.
const acknowledged = $derived(collision.suppressed && !collision.escalating);
</script>

{#if contacts.length > 0}
  <!-- No aria-live here: App owns the single assertive collision channel (a concise spoken summary in
       a persistent role=alert region), so announcing this whole contact list assertively too would
       double-speak the danger. This stays a labeled visual landmark. -->
  <aside
    class="bottom-strip {worstIsDanger ? 'bottom-strip--alarm' : 'bottom-strip--warning'}"
    class:is-ack={acknowledged}
    aria-label={worstIsDanger ? 'Collision danger' : 'Collision warning'}
  >
    <div class="head">
      <span class="title">{worstIsDanger ? 'Danger' : 'Caution'}</span>
      {#if acknowledged}
        <span class="note ack-tag">Acknowledged</span>
      {/if}
      {#if computedFallback}
        <span class="note">computing locally</span>
      {/if}
      {#if !acknowledged}
        <div class="actions actions--safety">
          <!-- A stable "Mute" label with aria-pressed carrying the on state: a label that flips to
               "Unmute" reads as a different action mid-incident, and a mute toggle is not
               destructive, so it stays a plain .ack rather than the warning variant. -->
          <button type="button" class="ack" aria-pressed={muted} onclick={onToggleMute}>
            Mute
          </button>
          <button type="button" class="ack" onclick={() => collision.acknowledge()}>
            Acknowledge
          </button>
        </div>
      {/if}
    </div>
    <ul class="bare-list list">
      {#each top as contact (contact.id)}
        <li class="row">
          <span
            class="name"
            class:sev-danger={contact.severity === 'danger'}
            class:sev-warning={contact.severity === 'warning'}
            >{vesselLabel(contact.name, contact.id)}</span
          >
          <span class="metric" title="Closest point of approach: how near this vessel will pass">
            CPA <b>{formatNm(contact.cpaMeters)}</b> nm
          </span>
          <span class="metric" title="Time to the closest point of approach">
            TCPA <b>{formatTcpaMin(contact.tcpaSeconds, 1)}</b> min
          </span>
        </li>
      {/each}
    </ul>
    {#if overflow > 0}
      <p class="more muted-note">+{overflow} more</p>
    {/if}
    {#if unassessedCount > 0}
      <p class="more muted-note">
        +{unassessedCount}
        unassessed: course or motion data missing, cannot be graded clear
      </p>
    {/if}
  </aside>
{/if}

<style>
/* The pressed visual carries the muted state, since the label stays a stable "Mute". */
.bottom-strip .ack[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--accent-tint);
}
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.more {
  margin-block-start: 0.3rem;
  font-size: var(--text-xs);
}
</style>

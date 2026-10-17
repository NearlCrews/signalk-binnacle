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
  // Open this contact's AIS detail. Mid-incident, identifying the vessel the strip already names
  // otherwise costs four taps from the far corner of the screen.
  onSelectContact?: (id: string) => void;
}

const { collision, muted, onToggleMute, onSelectContact }: Props = $props();

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
    class="bottom-strip collision-strip {worstIsDanger
      ? 'bottom-strip--alarm'
      : 'bottom-strip--warning'}"
    class:is-ack={acknowledged}
    aria-label={worstIsDanger ? 'Collision danger' : 'Collision warning'}
  >
    <div class="head">
      <span class="title">{worstIsDanger ? 'Danger' : 'Caution'}</span>
      {#if computedFallback}
        <span class="note note--provenance">computing locally</span>
      {/if}
      <!-- Both actions keep their slots: acknowledging leaves its word in place of the button, and
           Mute stays where it was. -->
      <div class="action-group actions--safety">
        <!-- A stable "Mute" label with aria-pressed carrying the on state: a label that flips to
             "Unmute" reads as a different action mid-incident, and a mute toggle is not
             destructive, so it stays a plain .btn-strip rather than the warning variant. -->
        <button
          type="button"
          class="btn btn-pill btn-strip"
          aria-pressed={muted}
          onclick={onToggleMute}
        >
          Mute
        </button>
        {#if acknowledged}
          <span class="note ack-tag">Acknowledged</span>
        {:else}
          <button
            type="button"
            class="btn btn-pill btn-strip"
            onclick={() => collision.acknowledge()}
          >
            Acknowledge
          </button>
        {/if}
      </div>
    </div>
    <ul class="bare-list list">
      {#each top as contact (contact.id)}
        <li class="row">
          {#if onSelectContact}
            <button
              type="button"
              class="name name-btn"
              class:sev-danger={contact.severity === 'danger'}
              class:sev-warning={contact.severity === 'warning'}
              title="Open this vessel in Nearby vessels"
              onclick={() => onSelectContact(contact.id)}
            >
              {vesselLabel(contact.name, contact.id)}
            </button>
          {:else}
            <span
              class="name"
              class:sev-danger={contact.severity === 'danger'}
              class:sev-warning={contact.severity === 'warning'}
              >{vesselLabel(contact.name, contact.id)}</span
            >
          {/if}
          <div class="data-cell" title="Closest point of approach: how near this vessel will pass">
            <span class="data-cell-label">CPA</span>
            <span class="data-cell-value"
              ><b class="num">{formatNm(contact.cpaMeters)}</b><span>nm</span></span
            >
          </div>
          {#if contact.receding}
            <!-- A held contact past its closest approach: a countdown would read as still closing,
                 so the TCPA cell says it passed, in the same column. -->
            <div class="data-cell" title="This vessel has passed its closest point and is opening">
              <span class="data-cell-label">TCPA</span>
              <span class="data-cell-value"><span class="word">Passed</span></span>
            </div>
          {:else}
            <div class="data-cell" title="Time to the closest point of approach">
              <span class="data-cell-label">TCPA</span>
              <span class="data-cell-value"
                ><b class="num">{formatTcpaMin(contact.tcpaSeconds, 1)}</b><span>min</span></span
              >
            </div>
          {/if}
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
.bottom-strip .btn-strip[aria-pressed="true"] {
  border-color: var(--accent);
  background: var(--accent-tint);
}
/* The contact name is the door to its live detail: the strip's own row styling, with the button
   chrome stripped and an underline so it reads as the one tappable thing in the row. */
.name-btn {
  border: 0;
  background: none;
  padding: 0;
  min-block-size: var(--control-size);
  min-inline-size: var(--control-size);
  font: inherit;
  text-align: start;
  text-decoration: underline;
  text-underline-offset: 0.2em;
  cursor: pointer;
}
.name-btn.sev-danger {
  color: var(--alarm);
}
.name-btn.sev-warning {
  color: var(--warning);
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
/* Each contact is one row of the same three columns (the name, then CPA and TCPA as data cells), so
   the decision numbers stack in columns down the list. The top alert's decision numbers outrank an
   ordinary instrument numeral: these are what the helm acts on. Applies to Danger and Caution alike;
   the title size is the shared alarm-strip one. */
.collision-strip {
  --data-value-size: var(--text-readout-lg);
  --data-value-line: 2.25rem;
}
.list .row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(2, 6.5rem);
  align-items: center;
}
.list .data-cell {
  block-size: auto;
  min-block-size: var(--control-size);
}
@media (max-width: 600px) {
  /* The contact name owns its own line at phone width instead of truncating beside two metrics,
     and the provenance note yields its space: which device computed CPA is the least
     decision-relevant fact on the card, and the source-trace surfaces retain it. */
  .note--provenance {
    display: none;
  }
  .list .row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .list .row .name {
    grid-column: 1 / -1;
    white-space: normal;
  }
}
</style>

<script lang="ts">
import type { ActiveNotification } from '$entities/notifications';
import {
  canAcknowledgeNotification,
  canSilenceNotification,
  notificationLabel,
} from './notification-actions';

interface Props {
  // The generic alarm list the controller selected, already stripped of the hazards Binnacle
  // surfaces on their own strips.
  notifications: ActiveNotification[];
  // Whether the generic alarm tone is audible right now, which is what "Mute here" acts on.
  sounding: boolean;
  // Whether this device has muted the current activation, the fallback when the server cannot
  // silence the alert itself.
  locallyMuted: boolean;
  writeBlocked: boolean;
  onSilence?: (n: ActiveNotification) => void;
  onAcknowledge?: (n: ActiveNotification) => void;
  onMuteHere: () => void;
  onOpenAlarms: () => void;
}

const {
  notifications,
  sounding,
  locallyMuted,
  writeBlocked,
  onSilence,
  onAcknowledge,
  onMuteHere,
  onOpenAlarms,
}: Props = $props();

// Only the audible grades raise a strip. A warning or an alert is real, but it belongs to the
// badge and the panel: a strip that appears for every low-grade notice stops meaning "act now".
const raised = $derived(
  notifications.filter((n) => n.state === 'alarm' || n.state === 'emergency'),
);
// Worst first by grade, not by list order, so the strip cannot be captured by whichever alert the
// caller happened to sort to the front.
const worst = $derived(raised.find((n) => n.state === 'emergency') ?? raised[0]);
const others = $derived(raised.length - 1);

const label = $derived(worst ? notificationLabel(worst) : undefined);
const title = $derived(worst?.state === 'emergency' ? 'Emergency' : 'Alarm');

const canSilence = $derived(worst !== undefined && canSilenceNotification(worst));
const canAcknowledge = $derived(worst !== undefined && canAcknowledgeNotification(worst));
// Whether the boat-wide Silence is actually on offer here, which needs the server capability, a
// wired handler, and a write token alike. The local mute keys off this rather than off the
// capability alone: a server that can silence is no help to a device that cannot ask it to, and
// gating the two controls on different conditions left a sounding alarm with neither.
const silenceOffered = $derived(onSilence !== undefined && canSilence && !writeBlocked);
// Quieted means the noise is handled, boat-wide or on this device, while the condition itself
// persists: the strip dims and keeps its readout rather than vanishing. Sounding is the
// authoritative noise flag and it comes first, because a local mute covers only the alarms audible
// when it was tapped: a later alarm leaves locallyMuted true while the boat can plainly hear a
// tone, and a dimmed strip would report that as handled.
const quieted = $derived(!sounding && (locallyMuted || raised.every((n) => n.silenced === true)));

function silence(): void {
  if (worst) onSilence?.(worst);
}

function acknowledge(): void {
  if (worst) onAcknowledge?.(worst);
}
</script>

{#if worst}
  <!-- No aria-live here: App owns the single assertive notification channel, mirroring the
       collision, MOB, and anchor strips. This stays a labeled visual landmark. -->
  <aside class="bottom-strip bottom-strip--alarm" class:is-ack={quieted} aria-label={title}>
    <div class="head">
      <span class="title">{title}</span>
      {#if others > 0}
        <span class="note">+{others} more</span>
      {/if}
      {#if quieted}
        <span class="note ack-tag">{locallyMuted ? 'Muted here' : 'Silenced'}</span>
      {/if}
      <div class="actions actions--safety">
        {#if silenceOffered}
          <button type="button" class="ack" onclick={silence}>Silence</button>
        {/if}
        <!-- Device-local mute wherever the boat-wide Silence does not cover everything sounding:
             Silence acts on the worst alert only, so with a second unsilenced alert up, both
             controls offer, and a sounding alarm always has at least one. It acts on the sound, so
             it appears only while there is a sound to act on. The title spells out the narrower
             scope, which the two similar labels do not. -->
        {#if sounding && (!silenceOffered || raised.filter((n) => n.silenced !== true).length > 1)}
          <button
            type="button"
            class="ack"
            title="Stop the sound on this device only"
            onclick={onMuteHere}
          >
            Mute here
          </button>
        {/if}
        {#if onAcknowledge && canAcknowledge && !writeBlocked}
          <button type="button" class="ack" onclick={acknowledge}>Acknowledge</button>
        {/if}
        <button type="button" class="ack" onclick={onOpenAlarms}>Open Alarms</button>
      </div>
    </div>
    <div class="row">
      <span class="name">{label}</span>
    </div>
  </aside>
{/if}

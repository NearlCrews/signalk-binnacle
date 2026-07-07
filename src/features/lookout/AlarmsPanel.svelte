<script lang="ts">
import { Bell, BellOff } from '@lucide/svelte';
import type { ActiveNotification, NotificationsStore } from '$entities/notifications';
import { formatClockTime, metersToNauticalMiles, nauticalMilesToMeters } from '$shared/lib';
import { DEFAULT_THRESHOLDS, type PersistedValue, type Thresholds } from '$shared/settings';
import { Disclosure, SlideOver, UnitField } from '$shared/ui';
import { thresholdsCaution } from './thresholds-caution';

// Humanize the raw Signal K alert state so a novice does not read truncated words like "WARN".
const STATE_LABELS: Record<string, string> = {
  warn: 'Warning',
  alert: 'Alert',
  alarm: 'Alarm',
  emergency: 'Emergency',
};
const stateLabel = (state: string): string => STATE_LABELS[state] ?? state;

interface Props {
  notifications: NotificationsStore;
  // A transient silence or acknowledge failure, surfaced because a refused action is otherwise
  // indistinguishable from a slow stream echo while the alarm keeps sounding.
  error?: string;
  onSilence?: (n: ActiveNotification) => void;
  onAcknowledge?: (n: ActiveNotification) => void;
  thresholds: PersistedValue<Thresholds>;
  collisionMuted: boolean;
  collisionMuteRemainingMin: number | undefined;
  onToggleCollisionMute: () => void;
  arrivalMuted: boolean;
  onToggleArrivalMute: () => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  notifications,
  error,
  onSilence,
  onAcknowledge,
  thresholds,
  collisionMuted,
  collisionMuteRemainingMin,
  onToggleCollisionMute,
  arrivalMuted,
  onToggleArrivalMute,
  onClose,
  onBack,
}: Props = $props();

const t = $derived(thresholds.value);
const alerts = $derived(notifications.list());

// The path tail identifies an alert that arrived without a message.
const alertLabel = (n: ActiveNotification): string =>
  n.message || n.path.replace(/^notifications\./, '');

const alertTime = (n: ActiveNotification): string | undefined => {
  const ms = n.timestamp ? Date.parse(n.timestamp) : Number.NaN;
  return Number.isFinite(ms) ? formatClockTime(ms) : undefined;
};

// The v2 silence and acknowledge routes address the server-assigned id, so both need one;
// the server also refuses to silence an emergency, and a state change resets both flags.
const canSilence = (n: ActiveNotification): boolean =>
  n.id !== undefined &&
  n.state !== 'emergency' &&
  n.canSilence !== false &&
  !n.silenced &&
  !n.acknowledged;

const canAcknowledge = (n: ActiveNotification): boolean =>
  n.id !== undefined && n.canAcknowledge !== false && !n.acknowledged;

// Stored values are SI (meters, seconds); the editor works in nautical miles and minutes and
// converts at this edge. UnitField commits on blur, so typing is not reformatted mid-keystroke,
// and snaps its text back to the value prop, so a rejected negative entry never looks accepted.
function setMeters(key: 'dangerCpaMeters' | 'warningCpaMeters', nm: number): void {
  if (!Number.isFinite(nm) || nm < 0) return;
  thresholds.set({ ...thresholds.value, [key]: nauticalMilesToMeters(nm) });
}

function setSeconds(key: 'dangerTcpaSeconds' | 'warningTcpaSeconds', minutes: number): void {
  if (!Number.isFinite(minutes) || minutes < 0) return;
  thresholds.set({ ...thresholds.value, [key]: minutes * 60 });
}

const cpaNm = (meters: number): number => metersToNauticalMiles(meters) ?? 0;
const tcpaMin = (seconds: number): number => seconds / 60;

const caution = $derived(thresholdsCaution(t));
</script>

<SlideOver title="Alarms" closeLabel="Close alarms panel" {onClose} {onBack} bodyFlex>
  {#if error}
    <p class="alert-note" role="alert">{error}</p>
  {/if}
  <p class="muted-note">
    Active alarms show here. Silence stops the sound, acknowledge clears it. Tune the collision
    warning below.
  </p>
  <section class="panel-section" aria-label="Active alerts">
    <h3 class="caps-label">Active alerts</h3>
    {#each alerts as n (n.path)}
      {@const time = alertTime(n)}
      <div class="alert-row card-frame">
        <span class="state-tag caps-label {n.state}">{stateLabel(n.state)}</span>
        <div class="alert-main">
          <span class="alert-message">{alertLabel(n)}</span>
          {#if time}
            <span class="alert-time muted-note">{time}</span>
          {/if}
        </div>
        <div class="alert-actions">
          {#if n.silenced}
            <span class="flag-tag muted-note">Silenced</span>
          {:else if onSilence && canSilence(n)}
            <button
              type="button"
              class="btn btn-ghost"
              title="Stop the sound now"
              onclick={() => onSilence(n)}
            >
              Silence
            </button>
          {/if}
          {#if n.acknowledged}
            <span class="flag-tag muted-note">Acknowledged</span>
          {:else if onAcknowledge && canAcknowledge(n)}
            <button
              type="button"
              class="btn btn-ghost"
              title="Mark as seen and clear it"
              onclick={() => onAcknowledge(n)}
            >
              Acknowledge
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <p class="muted-note">No active alerts. Alarms appear here when one triggers.</p>
    {/each}
  </section>
  <section class="panel-section" aria-label="Mutes">
    <h3 class="caps-label">Mutes</h3>
    <button
      type="button"
      class="btn mute-row"
      class:is-on={collisionMuted}
      aria-pressed={collisionMuted}
      onclick={onToggleCollisionMute}
    >
      {#if collisionMuted}
        <BellOff size={18} aria-hidden="true" />
      {:else}
        <Bell size={18} aria-hidden="true" />
      {/if}
      <span>Mute collision alarm</span>
    </button>
    {#if collisionMuted && collisionMuteRemainingMin !== undefined}
      <p class="muted-note">Turns back on in {collisionMuteRemainingMin} min</p>
    {/if}
    <button
      type="button"
      class="btn mute-row"
      class:is-on={arrivalMuted}
      aria-pressed={arrivalMuted}
      onclick={onToggleArrivalMute}
    >
      {#if arrivalMuted}
        <BellOff size={18} aria-hidden="true" />
      {:else}
        <Bell size={18} aria-hidden="true" />
      {/if}
      <span>Mute waypoint arrival alarm</span>
    </button>
  </section>
  <section class="panel-section" aria-label="Collision thresholds">
    <h3 class="caps-label">Collision alarm</h3>
    <p class="muted-note">
      Warn me when another vessel will pass closer than this distance (the closest pass) within this
      much time.
    </p>
    <Disclosure label="Adjust collision alarm sensitivity">
      <div class="group">
        <span class="group-title caps-label danger">Danger</span>
        <UnitField
          label="Closest pass"
          unit="nm"
          min={0}
          step={0.05}
          ariaLabel="Danger closest pass distance"
          value={cpaNm(t.dangerCpaMeters)}
          onCommit={(nm) => setMeters('dangerCpaMeters', nm)}
        />
        <UnitField
          label="Time to closest"
          unit="min"
          min={0}
          step={1}
          ariaLabel="Danger time to closest pass"
          value={tcpaMin(t.dangerTcpaSeconds)}
          onCommit={(minutes) => setSeconds('dangerTcpaSeconds', minutes)}
        />
      </div>
      <div class="group">
        <span class="group-title caps-label warning">Warning</span>
        <UnitField
          label="Closest pass"
          unit="nm"
          min={0}
          step={0.05}
          ariaLabel="Warning closest pass distance"
          value={cpaNm(t.warningCpaMeters)}
          onCommit={(nm) => setMeters('warningCpaMeters', nm)}
        />
        <UnitField
          label="Time to closest"
          unit="min"
          min={0}
          step={1}
          ariaLabel="Warning time to closest pass"
          value={tcpaMin(t.warningTcpaSeconds)}
          onCommit={(minutes) => setSeconds('warningTcpaSeconds', minutes)}
        />
      </div>
      {#if caution}
        <p class="muted-note sev-warning" role="status">{caution}</p>
      {/if}
      <button
        type="button"
        class="btn btn-ghost reset"
        onclick={() => thresholds.set({ ...DEFAULT_THRESHOLDS })}
      >
        Reset to defaults
      </button>
    </Disclosure>
  </section>
</SlideOver>

<style>
/* The titled sections use the shared .panel-section class in panels.css. */
/* The border, radius, and raised fill come from the shared .card-frame; only the row layout is here. */
.alert-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
}
.state-tag {
  padding: 0.1rem var(--space-2);
  border: 1px solid currentColor;
  border-radius: var(--radius-pill);
}
/* Severity colors reuse the alarm and warning tokens, so the tags hold in night-red. */
.state-tag.emergency,
.state-tag.alarm {
  color: var(--alarm);
  background: var(--alarm-tint);
}
.state-tag.warn {
  color: var(--warning);
}
.state-tag.alert {
  /* The lowest raised grade still outranks normal text in the severity ladder, so it keeps the
     full text color; muted is reserved for cleared states. */
  color: var(--text);
}
.alert-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.1rem;
  min-inline-size: 0;
}
.alert-message {
  overflow-wrap: anywhere;
}
.alert-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-1);
}
.alert-time,
.flag-tag {
  flex-shrink: 0;
}
/* On the shared .btn base; a mute reads as a row, not a centered button. */
.mute-row {
  justify-content: flex-start;
  gap: var(--space-2);
  text-align: start;
}
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
/* The base look is the shared .caps-label; only the per-severity color is overridden here. */
.group-title.danger {
  color: var(--alarm);
}
.group-title.warning {
  color: var(--warning);
}
.reset {
  align-self: flex-start;
  margin-block-start: 0.1rem;
}
</style>

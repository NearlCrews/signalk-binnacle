<script lang="ts">
import Bell from '@lucide/svelte/icons/bell';
import BellOff from '@lucide/svelte/icons/bell-off';
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import { untrack } from 'svelte';
import {
  type ActiveNotification,
  MAX_ACTIVE_NOTIFICATIONS,
  type NotificationsStore,
} from '$entities/notifications';
import type { UnitsStore } from '$entities/units';
import { type AlarmAudioState, alarmAudioNote } from '$shared/audio';
import {
  feetToMeters,
  formatClockTime,
  formatLengthOr,
  lengthUnit,
  metersToFeet,
  metersToNauticalMiles,
  nauticalMilesToMeters,
} from '$shared/lib';
import {
  DEFAULT_THRESHOLDS,
  MAX_COLLISION_CPA_METERS,
  MAX_COLLISION_TCPA_SECONDS,
  MAX_SHALLOW_DEPTH_METERS,
  type PersistedValue,
  type Thresholds,
} from '$shared/settings';
import { type AuthController, type ConnectionPhase, isConnectionDown } from '$shared/signalk';
import { Disclosure, InlineConfirm, SlideOver, UnitField, WriteAccessNote } from '$shared/ui';
import {
  canAcknowledgeNotification,
  canSilenceNotification,
  notificationLabel,
} from './notification-actions';
import type { ShallowMonitorSnapshot } from './shallow-monitor.svelte';
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
  auth: AuthController;
  connectionPhase: ConnectionPhase;
  // Alarm audio cannot sound (no priming gesture since load), so alarms are visual-only.
  audioState?: AlarmAudioState;
  notifications: NotificationsStore;
  // A transient silence or acknowledge failure, surfaced because a refused action is otherwise
  // indistinguishable from a slow stream echo while the alarm keeps sounding.
  error?: string;
  onSilence?: (n: ActiveNotification) => void;
  onAcknowledge?: (n: ActiveNotification) => void;
  thresholds: PersistedValue<Thresholds>;
  units: UnitsStore;
  // The shallow monitor's live state. Absent (an older caller, or SSR) leaves the section on the
  // locally configured threshold, which is what it did before the monitor existed.
  shallow?: ShallowMonitorSnapshot;
  collisionMuted: boolean;
  collisionMuteRemainingMin: number | undefined;
  onToggleCollisionMute: () => void;
  arrivalMuted: boolean;
  onToggleArrivalMute: () => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  auth,
  connectionPhase,
  audioState = 'ready',
  notifications,
  error,
  onSilence,
  onAcknowledge,
  thresholds,
  units,
  shallow,
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
let pendingAction = $state<string | undefined>();
let confirmingReset = $state(false);

const localTime = (timestamp: string | undefined): string | undefined => {
  const ms = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isFinite(ms) ? formatClockTime(ms) : undefined;
};

// Stored values are SI (meters, seconds); the editor works in nautical miles and minutes and
// converts at this edge. UnitField commits on blur, so typing is not reformatted mid-keystroke,
// and snaps its text back to the value prop, so a rejected negative entry never looks accepted.
function setMeters(key: 'dangerCpaMeters' | 'warningCpaMeters', nm: number): void {
  const meters = nauticalMilesToMeters(nm);
  if (!Number.isFinite(meters) || meters < 0 || meters > MAX_COLLISION_CPA_METERS) return;
  thresholds.set({ ...thresholds.value, [key]: meters });
}

function setSeconds(key: 'dangerTcpaSeconds' | 'warningTcpaSeconds', minutes: number): void {
  const seconds = minutes * 60;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_COLLISION_TCPA_SECONDS) return;
  thresholds.set({ ...thresholds.value, [key]: seconds });
}

const cpaNm = (meters: number): number => metersToNauticalMiles(meters) ?? 0;
const tcpaMin = (seconds: number): number => seconds / 60;

// The shallow-water threshold follows the server unit preference (meters or feet), unlike CPA and
// TCPA above, which always read as nautical miles and minutes regardless of that preference.
const shallowDepthMeters = $derived(t.shallowDepthMeters ?? DEFAULT_THRESHOLDS.shallowDepthMeters);
const shallowDepthDisplay = $derived(
  units.mode === 'imperial' ? (metersToFeet(shallowDepthMeters) ?? 0) : (shallowDepthMeters ?? 0),
);
function setShallowDepth(value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  const meters = units.mode === 'imperial' ? feetToMeters(value) : value;
  if (!Number.isFinite(meters) || meters > MAX_SHALLOW_DEPTH_METERS) return;
  thresholds.set({ ...thresholds.value, shallowDepthMeters: meters });
}

// The server's depth zones merge conservatively with the local threshold: the deeper bound fires
// the alarm, so the editor always stays and a note names the server's bound when one exists.
const serverShallowBound = $derived(shallow?.serverLimitMeters);

const caution = $derived(thresholdsCaution(t));
const maxCpaNm = cpaNm(MAX_COLLISION_CPA_METERS);
const maxTcpaMin = MAX_COLLISION_TCPA_SECONDS / 60;
const maxShallowDepth = $derived(
  units.mode === 'imperial'
    ? (metersToFeet(MAX_SHALLOW_DEPTH_METERS) ?? MAX_SHALLOW_DEPTH_METERS)
    : MAX_SHALLOW_DEPTH_METERS,
);

function runAction(kind: 'silence' | 'acknowledge', notification: ActiveNotification): void {
  if (auth.writeBlocked || pendingAction) return;
  pendingAction = `${kind}:${notification.path}`;
  if (kind === 'silence') onSilence?.(notification);
  else onAcknowledge?.(notification);
}

$effect(() => {
  const pending = pendingAction;
  const currentError = error;
  const currentAlerts = alerts;
  if (!pending) return;
  const separator = pending.indexOf(':');
  const kind = pending.slice(0, separator);
  const path = pending.slice(separator + 1);
  const notification = currentAlerts.find((candidate) => candidate.path === path);
  if (
    currentError ||
    !notification ||
    (kind === 'silence'
      ? !canSilenceNotification(notification)
      : !canAcknowledgeNotification(notification))
  ) {
    untrack(() => (pendingAction = undefined));
  }
});
</script>

<SlideOver title="Alarms" closeLabel="Close alarms panel" {onClose} {onBack} bodyFlex>
  {#if error}
    <p class="alert-note" role="alert">{error}</p>
  {/if}
  {#if auth.writeBlocked}
    <WriteAccessNote
      message="This display has read-only access, so alarms cannot be silenced or acknowledged from here. Request read and write access; the boat's Signal K admin approves it."
      requesting={auth.upgrading}
      onRequest={() => void auth.requestWriteAccess()}
      outcome={auth.upgradeOutcome}
    />
  {/if}
  {#if isConnectionDown(connectionPhase)}
    <p class="alert-note" role="alert">
      Signal K is disconnected. Active alarm status may be stale until the stream reconnects.
    </p>
  {/if}
  {#if alarmAudioNote(audioState)}
    <!-- No role: the status-strip chip is the polite announcement surface for this condition. -->
    <p class="alert-note">{alarmAudioNote(audioState)}</p>
  {/if}
  <p class="muted-note">
    Active alarms show here. Silence stops the sound, acknowledge clears it. Tune the collision
    warning below.
  </p>
  <section class="panel-section" aria-label="Active alerts">
    <h3 class="caps-label">Active alerts</h3>
    {#each alerts as n (n.path)}
      {@const time = localTime(n.timestamp)}
      {@const acknowledgedTime = localTime(n.acknowledgedAt)}
      <div class="alert-row card-frame">
        <span class="state-tag caps-label {n.state}">{stateLabel(n.state)}</span>
        <div class="alert-main">
          <span class="alert-message">{notificationLabel(n)}</span>
          {#if time}
            <span class="alert-time muted-note">{time}</span>
          {/if}
        </div>
        <div class="alert-actions">
          {#if n.silenced}
            <span class="flag-tag muted-note">Silenced</span>
          {:else if onSilence && canSilenceNotification(n)}
            <button
              type="button"
              class="btn btn-ghost"
              title="Stop the sound now"
              onclick={() => runAction('silence', n)}
              disabled={auth.writeBlocked || pendingAction !== undefined}
            >
              Silence
            </button>
          {/if}
          {#if n.acknowledged}
            <span class="flag-tag muted-note"
              >Acknowledged{acknowledgedTime ? ` ${acknowledgedTime}` : ''}</span
            >
          {:else if onAcknowledge && canAcknowledgeNotification(n)}
            <button
              type="button"
              class="btn btn-ghost"
              title="Mark as seen and clear it"
              onclick={() => runAction('acknowledge', n)}
              disabled={auth.writeBlocked || pendingAction !== undefined}
            >
              Acknowledge
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <p class="muted-note">
        {connectionPhase === 'open'
          ? 'No active alerts. Alarms appear here when one triggers.'
          : 'No cached active alerts. Signal K is not connected.'}
      </p>
    {/each}
    {#if alerts.length >= MAX_ACTIVE_NOTIFICATIONS}
      <p class="muted-note" role="status">
        Showing up to {MAX_ACTIVE_NOTIFICATIONS} highest-severity alerts.
      </p>
    {/if}
    {#if pendingAction}
      <p class="muted-note" role="status">Updating alarm status…</p>
    {/if}
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
      <span class="mute-state" aria-hidden="true">{collisionMuted ? 'On' : 'Off'}</span>
    </button>
    {#if collisionMuted && collisionMuteRemainingMin !== undefined}
      <!-- A status region, like every other state line here. It re-announces once a minute while
           this panel is open, which is the intended cadence: a running silence on the collision
           alarm is worth a minute-by-minute reminder for as long as the navigator keeps the panel
           up, and the text changes no faster than that. -->
      <p class="muted-note" role="status">Turns back on in {collisionMuteRemainingMin} min</p>
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
      <span class="mute-state" aria-hidden="true">{arrivalMuted ? 'On' : 'Off'}</span>
    </button>
  </section>
  <section class="panel-section" aria-label="Collision thresholds">
    <h3 class="caps-label">Collision alarm</h3>
    <p class="muted-note">
      Warn me when another vessel will pass closer than this distance (the closest pass) within this
      much time.
    </p>
    <Disclosure label="Adjust collision alarm sensitivity">
      <div class="group card-frame">
        <span class="group-title caps-label danger">Danger</span>
        <UnitField
          label="Closest pass (CPA)"
          unit="nm"
          min={0}
          max={maxCpaNm}
          step={0.05}
          ariaLabel="Danger closest pass distance"
          value={cpaNm(t.dangerCpaMeters)}
          onCommit={(nm) => setMeters('dangerCpaMeters', nm)}
        />
        <UnitField
          label="Time to closest (TCPA)"
          unit="min"
          min={0}
          max={maxTcpaMin}
          step={1}
          ariaLabel="Danger time to closest pass"
          value={tcpaMin(t.dangerTcpaSeconds)}
          onCommit={(minutes) => setSeconds('dangerTcpaSeconds', minutes)}
        />
      </div>
      <div class="group card-frame">
        <span class="group-title caps-label warning">Warning</span>
        <UnitField
          label="Closest pass (CPA)"
          unit="nm"
          min={0}
          max={maxCpaNm}
          step={0.05}
          ariaLabel="Warning closest pass distance"
          value={cpaNm(t.warningCpaMeters)}
          onCommit={(nm) => setMeters('warningCpaMeters', nm)}
        />
        <UnitField
          label="Time to closest (TCPA)"
          unit="min"
          min={0}
          max={maxTcpaMin}
          step={1}
          ariaLabel="Warning time to closest pass"
          value={tcpaMin(t.warningTcpaSeconds)}
          onCommit={(minutes) => setSeconds('warningTcpaSeconds', minutes)}
        />
      </div>
      {#if caution}
        <p class="muted-note sev-warning" role="status">{caution}</p>
      {/if}
      <!-- Reset discards four tuned safety thresholds and the shallow depth at once, so it takes the
           deliberate second tap every other destructive action here takes. -->
      {#if confirmingReset}
        <InlineConfirm
          question="Reset all thresholds?"
          confirmLabel="Reset"
          onConfirm={() => {
            thresholds.set({ ...DEFAULT_THRESHOLDS });
            confirmingReset = false;
          }}
          onCancel={() => (confirmingReset = false)}
        />
      {:else}
        <button type="button" class="btn btn-ghost reset" onclick={() => (confirmingReset = true)}>
          Reset to defaults
        </button>
      {/if}
    </Disclosure>
  </section>
  <section class="panel-section" aria-label="Shallow water threshold">
    <h3 class="caps-label">Shallow water alarm</h3>
    <p class="muted-note">
      Warn me when the depth under the boat reads under this much. Binnacle uses depth below the
      keel when the server provides it.
    </p>
    <!-- A monitor that cannot see the bottom is a degraded safety state, not ordinary guidance, so
         it carries the caution color and icon rather than reading like the copy above it. The
         threshold field deliberately stays enabled: it is persisted configuration that takes effect
         the moment a depth source appears, and dockside setup is exactly when neither is true. -->
    {#if shallow?.monitorState === 'no-source'}
      <p class="muted-note sev-warning icon-note" role="status">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>No depth source is publishing. The shallow alarm cannot monitor.</span>
      </p>
    {:else if shallow?.monitorState === 'no-reading'}
      <p class="muted-note sev-warning icon-note" role="status">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>
          The sounder is publishing no usable depth reading. The shallow alarm cannot monitor.
        </span>
      </p>
    {/if}
    {#if serverShallowBound !== undefined}
      <p class="muted-note">
        The server's depth zones also alarm at
        <span class="num">{formatLengthOr(serverShallowBound, units.mode)}</span>
        {lengthUnit(units.mode)}. The deeper of that bound and this setting fires the alarm; edit
        the depth zones on the Signal K server to change the server's side.
      </p>
    {:else if shallow?.serverZonesActive}
      <p class="muted-note">
        The server's depth zones also arm the alarm alongside this setting, without naming a single
        bound; whichever condition reaches deeper fires it.
      </p>
    {/if}
    <UnitField
      label="Shallow depth"
      unit={lengthUnit(units.mode)}
      min={0}
      max={maxShallowDepth}
      step={units.mode === 'imperial' ? 1 : 0.5}
      ariaLabel="Shallow water depth threshold"
      value={shallowDepthDisplay}
      onCommit={setShallowDepth}
    />
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
  /* A real floor, not zero: the row wraps, so when the action buttons crowd a long message the
     actions drop to the next line instead of squeezing the text into a one-word column. */
  min-inline-size: 12rem;
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
/* The trailing state word makes the row read as the toggle it is, not a form field at rest:
   aria-pressed already tells assistive tech, this tells the eye. Accent while the mute is on,
   matching the lit row treatment. */
.mute-state {
  margin-inline-start: auto;
  color: var(--text-muted);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.mute-row.is-on .mute-state {
  color: var(--accent);
}
/* Each severity block is its own bordered card on the shared .card-frame surface, so Danger and
   Warning read as two groups at a glance instead of one four-field stack; only the column layout
   and its padding are scoped here. */
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
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

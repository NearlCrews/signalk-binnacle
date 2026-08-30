<script lang="ts">
import Bell from '@lucide/svelte/icons/bell';
import BellOff from '@lucide/svelte/icons/bell-off';
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import { onDestroy, untrack } from 'svelte';
import {
  type ActiveNotification,
  MAX_ACTIVE_NOTIFICATIONS,
  type NotificationsStore,
} from '$entities/notifications';
import type { UnitsStore } from '$entities/units';
import {
  type AlarmAudioState,
  alarmAudioNote,
  MAX_ALARM_VOLUME,
  MIN_ALARM_VOLUME,
  playTestTone,
} from '$shared/audio';
import {
  feetToMeters,
  formatClockTime,
  formatLengthOr,
  lengthUnit,
  metersToFeet,
  metersToNauticalMiles,
  nauticalMilesToMeters,
  vibrate,
} from '$shared/lib';
import type { WakeLockState } from '$shared/pwa';
import {
  DEFAULT_THRESHOLDS,
  MAX_COLLISION_CPA_METERS,
  MAX_COLLISION_TCPA_SECONDS,
  MAX_SHALLOW_DEPTH_METERS,
  type PersistedValue,
  type Thresholds,
} from '$shared/settings';
import { type AuthController, type ConnectionPhase, isConnectionDown } from '$shared/signalk';
import {
  ConfirmArm,
  Disclosure,
  InlineConfirm,
  SlideOver,
  UnitField,
  WriteAccessNote,
} from '$shared/ui';
import { ALARM_LOG_KIND_LABELS, type AlarmLog } from './alarm-log.svelte';
import type { AlarmVolumeSetting } from './alarm-volume';
import {
  canAcknowledgeNotification,
  canSilenceNotification,
  notificationLabel,
} from './notification-actions';
import { defaultShallowLimitMeters } from './shallow-alarm';
import type { ShallowMonitorSnapshot } from './shallow-monitor.svelte';
import { thresholdsCaution } from './thresholds-caution';
import type { ShallowPublishOutcome } from './zone-publish';

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
  // The one-tap flood relief over the server's bulk routes. Each renders only when wired and at
  // least two listed alerts can take that action; a single alert keeps its own button.
  onSilenceAll?: () => void;
  onAcknowledgeAll?: () => void;
  thresholds: PersistedValue<Thresholds>;
  units: UnitsStore;
  // The per-device alarm loudness. Absent (an older caller, or SSR) hides the volume slider while
  // the test button still proves the output path at whatever the device is set to.
  alarmVolume?: AlarmVolumeSetting;
  // The session alarm chronology. Absent hides the section entirely.
  alarmLog?: AlarmLog;
  // The screen wake lock the app holds while a watch is armed. Only the degraded grades get a
  // note; 'idle' and 'held' need no explanation.
  wakeLockState?: WakeLockState;
  // The boat's declared draft, so the shallow field's default reads as the effective
  // draft-plus-margin limit rather than the fixed fallback.
  draftMeters?: number;
  // The off-course (XTE) alarm controls. Absent hides the section entirely.
  xte?: {
    muted: boolean;
    setMuted: (v: boolean) => void;
    limitMeters: number;
    setLimitMeters: (m: number) => void;
    standing: 'server' | 'client';
    alarming: boolean;
  };
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
  onSilenceAll,
  onAcknowledgeAll,
  thresholds,
  units,
  alarmVolume,
  alarmLog,
  wakeLockState,
  draftMeters = undefined,
  xte,
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
const shallowDepthMeters = $derived(t.shallowDepthMeters ?? defaultShallowLimitMeters(draftMeters));
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

// Publishing changes what every station on the boat alarms on, so it takes the armed second tap
// every other boat-wide action takes; the armed label names the boat-wide effect and the number.
const publishArm = new ConfirmArm();
onDestroy(() => publishArm.disarm());

function tapPublish(): void {
  if (publishArm.tap()) void shallow?.publish?.publish();
}

const PUBLISH_OUTCOME_NOTES: Record<ShallowPublishOutcome, string> = {
  published:
    "Published. The server's depth zone now arms every station; the note above names its bound.",
  unsupported:
    'This Signal K server did not accept the zone write. Set the depth zones by hand in the ' +
    "server admin UI's Data Browser meta editor (the Data Fiddler) or the server's defaults.",
  refused: 'Signal K refused the write. Request read and write access above, then publish again.',
  failed: 'Publishing failed. Check the connection and try again.',
};

const caution = $derived(thresholdsCaution(t));
const volumePercent = $derived(Math.round((alarmVolume?.value ?? 1) * 100));
// Newest first for the chronology list: the last squall's events are what the reader came for.
const logEntries = $derived(alarmLog ? alarmLog.entries.toReversed() : []);
const maxCpaNm = cpaNm(MAX_COLLISION_CPA_METERS);
const maxTcpaMin = MAX_COLLISION_TCPA_SECONDS / 60;
const maxShallowDepth = $derived(
  units.mode === 'imperial'
    ? (metersToFeet(MAX_SHALLOW_DEPTH_METERS) ?? MAX_SHALLOW_DEPTH_METERS)
    : MAX_SHALLOW_DEPTH_METERS,
);

// A bulk action offers itself only past one actionable alert: below that the per-alert button is
// the same single tap, and "all" over one row reads as a broader promise than it keeps.
const silenceableCount = $derived(alerts.filter(canSilenceNotification).length);
const acknowledgeableCount = $derived(alerts.filter(canAcknowledgeNotification).length);

function runAction(kind: 'silence' | 'acknowledge', notification: ActiveNotification): void {
  if (auth.writeBlocked || pendingAction) return;
  // Tactile registration for a gloved tap: the audible state change lands only after the server
  // round-trip, so the buzz is the immediate sign the press took.
  vibrate(30);
  pendingAction = `${kind}:${notification.path}`;
  if (kind === 'silence') onSilence?.(notification);
  else onAcknowledge?.(notification);
}

// The bulk pending keys carry no colon, so they can never collide with a per-alert
// `kind:notifications.…` key.
function runBulkAction(kind: 'silence-all' | 'acknowledge-all'): void {
  if (auth.writeBlocked || pendingAction) return;
  vibrate(30);
  pendingAction = kind;
  if (kind === 'silence-all') onSilenceAll?.();
  else onAcknowledgeAll?.();
}

$effect(() => {
  const pending = pendingAction;
  const currentError = error;
  const currentAlerts = alerts;
  if (!pending) return;
  if (currentError) {
    untrack(() => (pendingAction = undefined));
    return;
  }
  let settled: boolean;
  if (pending === 'silence-all') {
    settled = !currentAlerts.some(canSilenceNotification);
  } else if (pending === 'acknowledge-all') {
    settled = !currentAlerts.some(canAcknowledgeNotification);
  } else {
    const separator = pending.indexOf(':');
    const kind = pending.slice(0, separator);
    const path = pending.slice(separator + 1);
    const notification = currentAlerts.find((candidate) => candidate.path === path);
    settled =
      !notification ||
      (kind === 'silence'
        ? !canSilenceNotification(notification)
        : !canAcknowledgeNotification(notification));
  }
  if (settled) untrack(() => (pendingAction = undefined));
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
  <p class="muted-note">
    Active alarms show here. Silence stops the sound, acknowledge clears it. Tune the collision
    warning below.
  </p>
  <section class="panel-section" aria-label="Active alerts">
    <h3 class="caps-label">Active alerts</h3>
    {#if (onSilenceAll && silenceableCount > 1) || (onAcknowledgeAll && acknowledgeableCount > 1)}
      <div class="bulk-actions">
        {#if onSilenceAll && silenceableCount > 1}
          <button
            type="button"
            class="btn btn-ghost"
            title="Stop the sound of every alert at once"
            onclick={() => runBulkAction('silence-all')}
            disabled={auth.writeBlocked || pendingAction !== undefined}
          >
            Silence all
          </button>
        {/if}
        {#if onAcknowledgeAll && acknowledgeableCount > 1}
          <button
            type="button"
            class="btn btn-ghost"
            title="Mark every alert as seen and clear them at once"
            onclick={() => runBulkAction('acknowledge-all')}
            disabled={auth.writeBlocked || pendingAction !== undefined}
          >
            Acknowledge all
          </button>
        {/if}
      </div>
    {/if}
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
  <section class="panel-section" aria-label="Alarm sound">
    <h3 class="caps-label">Alarm sound</h3>
    {#if alarmAudioNote(audioState)}
      <!-- No role: the status-strip chip is the polite announcement surface for this condition. -->
      <p class="alert-note">{alarmAudioNote(audioState)}</p>
    {/if}
    <p class="muted-note">
      Play the test to prove this display can sound an alarm before you rely on it.
    </p>
    <button
      type="button"
      class="btn sound-test"
      title="Play a short test burst at the set volume"
      onclick={() => playTestTone()}
      disabled={audioState === 'unsupported'}
    >
      Test alarm sound
    </button>
    {#if alarmVolume}
      <div class="volume-field">
        <div class="volume-head">
          <label class="volume-name" for="alarm-volume">Volume on this display</label>
          <span class="num">{volumePercent}%</span>
        </div>
        <input
          id="alarm-volume"
          class="range"
          type="range"
          min={MIN_ALARM_VOLUME}
          max={MAX_ALARM_VOLUME}
          step="0.05"
          value={alarmVolume.value}
          aria-valuetext={`${volumePercent}%`}
          oninput={(e) => alarmVolume?.set(Number(e.currentTarget.value))}
        >
      </div>
    {/if}
    {#if wakeLockState === 'unsupported'}
      <p class="muted-note">
        Over plain HTTP the browser cannot keep the screen awake, so an armed watch may go dark when
        the display locks. Serve Signal K over HTTPS to enable screen wake.
      </p>
    {:else if wakeLockState === 'failed'}
      <p class="muted-note">
        The browser refused the screen wake lock, often battery saver. The screen may sleep during
        an armed watch.
      </p>
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
  {#if xte}
    <section class="panel-section" aria-label="Off-course alarm">
      <h3 class="caps-label">Off-course alarm</h3>
      <p class="muted-note">
        Warn me when the boat strays farther than this from the active route leg.
      </p>
      {#if xte.standing === 'server'}
        <p class="muted-note">
          A server plugin raises the off-course alarm; this display follows it.
        </p>
      {/if}
      <button
        type="button"
        class="btn mute-row"
        class:is-on={xte.muted}
        aria-pressed={xte.muted}
        onclick={() => xte?.setMuted(!xte.muted)}
      >
        {#if xte.muted}
          <BellOff size={18} aria-hidden="true" />
        {:else}
          <Bell size={18} aria-hidden="true" />
        {/if}
        <span>Mute off-course alarm</span>
        <span class="mute-state" aria-hidden="true">{xte.muted ? 'On' : 'Off'}</span>
      </button>
      <UnitField
        label="Off-course limit"
        unit="m"
        min={20}
        max={2000}
        step={10}
        ariaLabel="Off-course alarm limit"
        value={xte.limitMeters}
        onCommit={(m) => xte?.setLimitMeters(m)}
      />
    </section>
  {/if}
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
    {#if shallow?.publish}
      {@const zonePublish = shallow.publish}
      <p class="muted-note">
        Publish writes the limit in force to the server as a depth alarm zone, so every station and
        app on the boat alarms on it. The published zone becomes the server's, and a server
        administrator can edit or remove it; the setting above stays as this display's fallback when
        no server zone exists.
      </p>
      <button
        type="button"
        class="btn btn-ghost publish"
        title="Write the current shallow limit to the server's depth zones"
        onclick={tapPublish}
        disabled={auth.writeBlocked || zonePublish.busy || zonePublish.winningPath === undefined}
      >
        {publishArm.armed
          ? `Alarm every station under ${formatLengthOr(zonePublish.effectiveLimitMeters, units.mode)} ${lengthUnit(units.mode)}?`
          : 'Publish to the boat'}
      </button>
      {#if zonePublish.busy}
        <p class="muted-note" role="status">Publishing the depth zone to the server…</p>
      {:else if zonePublish.outcome !== 'idle'}
        <p class="muted-note" class:sev-warning={zonePublish.outcome !== 'published'} role="status">
          {PUBLISH_OUTCOME_NOTES[zonePublish.outcome]}
        </p>
      {/if}
    {/if}
  </section>
  {#if alarmLog}
    <section class="panel-section" aria-label="Session chronology">
      <h3 class="caps-label">Session chronology</h3>
      {#if logEntries.length === 0}
        <p class="muted-note">
          No alarm events this session yet. What raises, clears, and gets silenced or muted will
          list here.
        </p>
      {:else}
        <ol class="bare-list log-list" reversed>
          {#each logEntries as entry (entry)}
            <li class="log-row muted-note">
              <span class="num log-time">{formatClockTime(entry.timeMs)}</span>
              <span class="log-text">
                {ALARM_LOG_KIND_LABELS[entry.kind]}: {entry.label}
                {entry.detail
                  ? `, ${entry.detail}`
                  : ''}
              </span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}
</SlideOver>

<style>
/* The titled sections use the shared .panel-section class in panels.css. */
/* The bulk pair sits above the list so a flood is answerable without scrolling past it. */
.bulk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-self: flex-start;
}
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
  color: var(--accent-tint-text);
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
.sound-test,
.publish {
  align-self: flex-start;
}
/* The mixed-controls field layout: label row with the live value, full-width slider beneath. */
.volume-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.volume-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}
.volume-name {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
/* Newest entries on top; past a screenful the rest scroll here instead of stretching the panel. */
.log-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-block-size: 13rem;
  overflow-y: auto;
}
.log-row {
  display: flex;
  gap: var(--space-2);
}
.log-time {
  flex-shrink: 0;
}
.log-text {
  overflow-wrap: anywhere;
}
</style>

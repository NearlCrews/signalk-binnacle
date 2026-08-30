<script lang="ts">
import Anchor from '@lucide/svelte/icons/anchor';
import Crosshair from '@lucide/svelte/icons/crosshair';
import { onDestroy, untrack } from 'svelte';
import {
  type AnchorMode,
  type AnchorWatch,
  CAPTURE_MARGIN_M,
  capturedRadius,
  MIN_RADIUS_M,
} from '$entities/anchor';
import type { TidesStore } from '$entities/tides';
import type { UnitsStore } from '$entities/units';
import { DEPTH_SOURCE_LABELS, DEPTH_SOURCE_TITLES, type OwnVessel } from '$entities/vessel';
import { type AlarmAudioState, alarmAudioNote } from '$shared/audio';
import {
  Clock,
  feetToMeters,
  formatClockTime,
  formatLengthOr,
  formatMetersOrNm,
  lengthUnit,
  MINUTE_MS,
  metersToFeet,
  PLACEHOLDER,
} from '$shared/lib';
import type { AuthController } from '$shared/signalk';
import {
  createPanelMinimize,
  Disclosure,
  InlineConfirm,
  SlideOver,
  UnitField,
  WriteAccessNote,
} from '$shared/ui';
import { nextTideExtremes } from './anchor-tides';
import { RODE_GPS_MARGIN_M, suggestWatchRadius } from './rode-radius';

interface Props {
  auth: AuthController;
  anchor: AnchorWatch;
  vessel: OwnVessel;
  units: UnitsStore;
  // A failed server call (set radius, move, raise), shown until the next anchor action.
  error?: string;
  busy?: boolean;
  // Alarm audio cannot sound (no priming gesture since load), so an armed watch is visual-only.
  audioState?: AlarmAudioState;
  // A low-battery warning from the controller's battery watch, while this browser carries the
  // watch; undefined when healthy, charging, server-mode, or on a browser without the API.
  batteryNote?: string;
  // The tides entity store, when the host wires it, for the nearby-station prediction summary.
  tides?: TidesStore;
  onDrop: () => void;
  onRaise: () => void;
  onSetRadius: (meters: number) => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  auth,
  anchor,
  vessel,
  units,
  error,
  busy = false,
  audioState = 'ready',
  batteryNote,
  tides,
  onDrop,
  onRaise,
  onSetRadius,
  onClose,
  onBack,
}: Props = $props();

const watching = $derived(anchor.watching);
const distance = $derived(anchor.fixLost ? undefined : anchor.distanceMeters);
const serverWritesBlocked = $derived(auth.writeBlocked && anchor.mode === 'server');
const mode = $derived(units.mode);
const unit = $derived(lengthUnit(mode));
// The spelled-out unit for accessible names, where the compact symbol reads poorly.
const unitWord = $derived(mode === 'imperial' ? 'feet' : 'meters');
// The radius field deals in the display unit; the entity stays meters, so imperial entries
// convert at the edges and round to whole display units.
const toDisplayUnits = (meters: number) =>
  Math.round(mode === 'imperial' ? (metersToFeet(meters) ?? 0) : meters);
const radiusDisplay = $derived(toDisplayUnits(anchor.radiusMeters ?? anchor.preferredRadiusMeters));
const minRadiusDisplay = $derived(toDisplayUnits(MIN_RADIUS_M));
const distanceText = $derived(formatLengthOr(distance, mode, 0));
const radiusText = $derived(watching ? formatLengthOr(anchor.radiusMeters, mode, 0) : PLACEHOLDER);
// Scope is reckoned against the water column, so the entity resolves this without the
// keel-corrected path. A stale reading holds out the number rather than passing off an old
// sounding as the depth the boat is lying in.
const depth = $derived(vessel.anchorDepth);
const depthText = $derived(formatLengthOr(depth.stale ? undefined : depth.meters, mode, 1));
const captureTitle = $derived(
  `Set the radius to the current distance plus a ${formatLengthOr(CAPTURE_MARGIN_M, mode, 0)} ${unit} margin`,
);

const MODE_STATUS: Record<AnchorMode, string> = {
  server: 'Watching on the server. The alarm keeps running when Binnacle is closed.',
  client: 'Watching in this browser only. Keep Binnacle open for the alarm.',
  off: 'No anchor down.',
};
// The degraded causes are worded apart: a down link and a held reconnect-stale window are not
// GPS losses. The panel words from the ungraced immediateDegradedCause (a panel is not a live
// region, so a routine sub-second reconnect blip cannot spam anyone, and the reassuring mode
// text must not stand in for a watch that cannot currently protect); the live region and strip
// keep waiting out the graces through degradedCause. One branch per state, so priority reads
// top down.
const immediateCause = $derived(anchor.immediateDegradedCause);
const statusAlarm = $derived(anchor.dragging || immediateCause !== undefined);
const statusLine = $derived.by(() => {
  if (immediateCause === 'fix-lost') {
    return 'Warning: GPS fix lost. Browser drag detection has stopped.';
  }
  if (immediateCause === 'link-lost') {
    return 'Warning: server connection lost. The server watch cannot alert this display.';
  }
  if (immediateCause === 'server-stale') {
    return 'Anchor watch state is stale: reconnecting to the server.';
  }
  if (anchor.fixLost)
    return 'GPS fix lost on this display. The server anchor watch remains active.';
  if (anchor.dragging) return 'Anchor dragging: the boat is outside the watch radius.';
  return MODE_STATUS[anchor.mode];
});

// Below-minimum entries clamp up, matching the entity; UnitField snaps the text back to the
// effective radius after the commit, so a rejected entry never sits in the box looking accepted.
// The entry arrives in the display unit and converts to meters before the clamp.
function commitRadius(entered: number): void {
  const meters = mode === 'imperial' ? feetToMeters(entered) : entered;
  onSetRadius(Math.max(MIN_RADIUS_M, meters));
}

// Raising ends the watch and silences the alarm in one motion, so the panel matches the strip's
// armed-confirm protection: the first tap swaps the controls row for an inline confirm.
let raiseArmed = $state(false);
const minimize = createPanelMinimize();
$effect(() => {
  // Reset the armed confirm when the watch ends. The write is untracked so the effect depends only on
  // `watching`, never re-running on its own reset (no read-and-write of the same signal).
  if (!watching) untrack(() => (raiseArmed = false));
});

// Capture the real swing: the live distance plus a safety margin becomes the new radius.
function captureFromDistance(): void {
  if (distance == null) return;
  onSetRadius(capturedRadius(distance));
}

// The rode helper's inputs are session-only, deliberately not persisted: rode paid out changes
// with every drop, and a stale remembered value would look authoritative. Zero means not entered
// yet. Boat length and depth come from the vessel when it declares them; the manual fields exist
// only for what the vessel cannot say.
let rodeMeters = $state<number | undefined>();
let manualDepthMeters = $state<number | undefined>();
let manualBoatMeters = $state<number | undefined>();

const liveDepthMeters = $derived(depth.stale ? undefined : depth.meters);
const boatLengthMeters = $derived(vessel.lengthMeters ?? manualBoatMeters);
const rodeDepthMeters = $derived(liveDepthMeters ?? manualDepthMeters);
const rodeSuggestion = $derived(
  suggestWatchRadius({ rodeMeters, depthMeters: rodeDepthMeters, boatLengthMeters }),
);
const rodeDisplay = $derived(rodeMeters === undefined ? 0 : toDisplayUnits(rodeMeters));
const toFineDisplayUnits = (meters: number | undefined) =>
  meters === undefined
    ? 0
    : Math.round((mode === 'imperial' ? (metersToFeet(meters) ?? 0) : meters) * 10) / 10;
const enteredMeters = (entered: number) =>
  entered > 0 ? (mode === 'imperial' ? feetToMeters(entered) : entered) : undefined;
const suggestionParts = $derived.by(() => {
  if (rodeSuggestion.state !== 'ok') return undefined;
  return {
    swing: formatLengthOr(rodeSuggestion.swingMeters, mode, 0),
    boat: formatLengthOr(boatLengthMeters, mode, 0),
    margin: formatLengthOr(RODE_GPS_MARGIN_M, mode, 0),
    radius: formatLengthOr(rodeSuggestion.radiusMeters, mode, 0),
  };
});

// Applies through the same setter and minimum clamp as a typed radius entry; never automatic.
function applySuggestion(): void {
  if (rodeSuggestion.state !== 'ok') return;
  onSetRadius(Math.max(MIN_RADIUS_M, rodeSuggestion.radiusMeters));
}

// A live clock so the "next" tide events stay current while the panel is open, not frozen at the
// last store refresh: a boat at anchor may not trigger a reload for hours.
const clock = new Clock(MINUTE_MS);
onDestroy(() => clock.dispose());
const tideReading = $derived(tides?.tide);
const tideExtremes = $derived(
  tideReading ? nextTideExtremes(tideReading.events, clock.now) : undefined,
);
const tideDistanceText = $derived(
  tideReading ? formatMetersOrNm(tideReading.distanceMeters, mode) : '',
);
</script>

<SlideOver
  title="Anchor watch"
  closeLabel="Close anchor watch"
  {onClose}
  {onBack}
  bodyFlex
  {minimize}
>
  {#if auth.writeBlocked}
    <!-- The app-wide banner offers the same request, but an open panel covers it on a phone, so the
         request stays one tap away from the block it explains. -->
    <WriteAccessNote
      message="Server anchor changes need read and write access. A browser-only watch remains available when no server watch is active."
      requesting={auth.upgrading}
      onRequest={() => void auth.requestWriteAccess()}
      outcome={auth.upgradeOutcome}
    />
  {/if}
  <p class="muted-note">
    Drop the anchor to start a drift alarm that sounds if the boat swings past the watch radius.
  </p>
  {#if alarmAudioNote(audioState)}
    <!-- No role: the status-strip chip is the polite announcement surface for this condition. -->
    <p class="alert-note">{alarmAudioNote(audioState)}</p>
  {/if}
  {#if batteryNote}
    <!-- role=alert: a dying device ends this watch, and the note appears at most twice per
         episode (low, then the critical escalation), so announcing it here cannot spam. -->
    <p class="alert-note" role="alert">{batteryNote}</p>
  {/if}
  <p
    class="muted-note status"
    class:status--alarm={statusAlarm}
    role={statusAlarm ? 'alert' : 'status'}
  >
    {statusLine}
  </p>
  <dl class="stat-grid">
    <dt>From anchor</dt>
    <dd><span class="num">{distanceText}</span><span class="unit">{unit}</span></dd>
    <dt>Radius</dt>
    <dd><span class="num">{radiusText}</span><span class="unit">{unit}</span></dd>
    {#if depth.source}
      <dt title={DEPTH_SOURCE_TITLES[depth.source]}>Depth ({DEPTH_SOURCE_LABELS[depth.source]})</dt>
      <dd><span class="num">{depthText}</span><span class="unit">{unit}</span></dd>
    {/if}
  </dl>
  {#if depth.source === undefined && vessel.safetyDepth.source === 'keel'}
    <p class="muted-note">
      The sounder publishes keel depth only, which understates the water column the rode spans, so
      no depth shows here.
    </p>
  {/if}
  <UnitField
    label="Watch radius"
    {unit}
    min={minRadiusDisplay}
    step={1}
    ariaLabel={`Watch radius in ${unitWord}`}
    value={radiusDisplay}
    disabled={busy || serverWritesBlocked}
    onCommit={commitRadius}
  />
  <p class="muted-note">The alarm sounds if the boat drifts further than this from the anchor.</p>
  <button
    type="button"
    class="btn btn-ghost"
    disabled={busy || serverWritesBlocked || !watching || distance == null}
    title={captureTitle}
    onclick={captureFromDistance}
  >
    <Crosshair size={16} aria-hidden="true" />
    Set radius to current swing
  </button>
  <Disclosure label="Suggest a radius from the rode">
    <p class="muted-note muted-note--xs">
      Horizontal swing from the rode and depth, plus the boat length and a
      {formatLengthOr(
        RODE_GPS_MARGIN_M,
        mode,
        0,
      )}
      {unit}
      GPS margin, rounded up.
    </p>
    <UnitField
      label="Rode paid out"
      {unit}
      min={0}
      step={1}
      ariaLabel={`Rode paid out in ${unitWord}`}
      value={rodeDisplay}
      onCommit={(entered) => {
        rodeMeters = enteredMeters(entered);
      }}
    />
    {#if vessel.lengthMeters === undefined}
      <UnitField
        label="Boat length"
        {unit}
        min={0}
        step={0.1}
        ariaLabel={`Boat length in ${unitWord}`}
        value={toFineDisplayUnits(manualBoatMeters)}
        onCommit={(entered) => {
          manualBoatMeters = enteredMeters(entered);
        }}
      />
    {/if}
    {#if liveDepthMeters !== undefined && depth.source !== undefined}
      <p class="muted-note muted-note--xs">
        Depth <span class="num">{formatLengthOr(liveDepthMeters, mode, 1)}</span>
        {unit}
        from the {DEPTH_SOURCE_LABELS[depth.source]} sounding. Depth changes with the tide.
      </p>
    {:else}
      <UnitField
        label="Depth at the anchor"
        {unit}
        min={0}
        step={0.1}
        ariaLabel={`Depth at the anchor in ${unitWord}`}
        value={toFineDisplayUnits(manualDepthMeters)}
        onCommit={(entered) => {
          manualDepthMeters = enteredMeters(entered);
        }}
      />
      <p class="muted-note muted-note--xs">
        No usable depth sounding, so enter the depth by hand. Depth changes with the tide.
      </p>
    {/if}
    {#if rodeSuggestion.state === 'rode-short'}
      <p class="control-error">
        The rode paid out does not reach past the depth: the anchor is hanging straight down, not
        set on the bottom.
      </p>
    {:else if suggestionParts}
      <p class="muted-note">
        Swing <span class="num">{suggestionParts.swing}</span>
        {unit}
        + boat <span class="num">{suggestionParts.boat}</span>
        {unit}
        + GPS margin <span class="num">{suggestionParts.margin}</span>
        {unit}.
      </p>
      <button
        type="button"
        class="btn"
        disabled={busy || serverWritesBlocked}
        onclick={applySuggestion}
      >
        Set watch radius to {suggestionParts.radius}
        {unit}
      </button>
    {:else}
      <p class="muted-note muted-note--xs">Enter the values above to get a suggested radius.</p>
    {/if}
  </Disclosure>
  {#if watching && raiseArmed}
    <InlineConfirm
      question="Raise the anchor and end the watch?"
      confirmLabel="Raise"
      onConfirm={() => {
        raiseArmed = false;
        if (!busy && !serverWritesBlocked) onRaise();
      }}
      onCancel={() => {
        raiseArmed = false;
      }}
    />
  {:else}
    <div class="panel-controls">
      {#if watching}
        <button
          type="button"
          class="btn btn-danger"
          disabled={busy || serverWritesBlocked}
          onclick={() => {
            raiseArmed = true;
          }}
        >
          <Anchor size={16} aria-hidden="true" />
          Raise anchor
        </button>
      {:else}
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy || !vessel.position || vessel.positionStale}
          onclick={onDrop}
        >
          <Anchor size={16} aria-hidden="true" />
          Drop anchor here
        </button>
      {/if}
    </div>
  {/if}
  {#if !watching && (!vessel.position || vessel.positionStale)}
    <p class="muted-note">
      {vessel.positionStale
        ? 'Waiting for a fresh GPS fix before dropping the anchor.'
        : 'Waiting for a GPS fix to drop the anchor at.'}
    </p>
  {/if}
  {#if watching}
    <p class="muted-note">Drag the anchor marker on the chart to correct the drop point.</p>
  {/if}
  {#if tides}
    <Disclosure label="Nearby tide prediction">
      {#if tideReading}
        <p class="tide-station">
          <span class="truncate">{tideReading.station.name}</span>
          <span class="caps-label">{tideDistanceText} away</span>
        </p>
        {#if tideReading.events.length === 0}
          <p class="muted-note" role="status">No predictions in this window.</p>
        {:else}
          <dl class="stat-grid">
            <dt>Next high</dt>
            <dd>
              {#if tideExtremes?.high}
                <span class="num"
                  >{formatClockTime(tideExtremes.high.timeMs)},
                  {formatLengthOr(
                    tideExtremes.high.heightMeters,
                    mode,
                    1,
                  )}</span
                ><span class="unit">{unit}</span>
              {:else}
                <span class="num">{PLACEHOLDER}</span><span class="unit"></span>
              {/if}
            </dd>
            <dt>Next low</dt>
            <dd>
              {#if tideExtremes?.low}
                <span class="num"
                  >{formatClockTime(tideExtremes.low.timeMs)},
                  {formatLengthOr(
                    tideExtremes.low.heightMeters,
                    mode,
                    1,
                  )}</span
                ><span class="unit">{unit}</span>
              {:else}
                <span class="num">{PLACEHOLDER}</span><span class="unit"></span>
              {/if}
            </dd>
          </dl>
        {/if}
        <p class="muted-note muted-note--xs">
          Predictions come from {tideReading.station.name}, {tideDistanceText} away, not from this
          anchorage. The tide here can differ, and the depth under the boat moves with it.
        </p>
      {:else if tides.status === 'loading'}
        <p class="muted-note" role="status">Loading tide predictions…</p>
      {:else if tides.status === 'no-coverage'}
        <p class="muted-note" role="status">
          No tide station nearby. NOAA tide predictions cover US waters only.
        </p>
      {:else if tides.status === 'error'}
        <p class="muted-note">Tide predictions did not load. Open Tides and currents to retry.</p>
      {:else}
        <p class="muted-note">Tide predictions have not loaded for this view yet.</p>
      {/if}
    </Disclosure>
  {/if}
  {#if error}
    <p class="alert-note" role="alert">{error}</p>
  {:else if busy}
    <p class="muted-note" role="status">Updating anchor watch…</p>
  {/if}
</SlideOver>

<style>
.status {
  font-size: var(--text-base);
}
.status--alarm {
  color: var(--alarm);
  font-weight: 600;
}
.tide-station {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  justify-content: space-between;
  margin: 0;
}
.tide-station .truncate {
  flex: 1;
  min-inline-size: 0;
}
.tide-station .caps-label {
  white-space: nowrap;
}
</style>

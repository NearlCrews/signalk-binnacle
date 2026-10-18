<script lang="ts">
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import VolumeX from '@lucide/svelte/icons/volume-x';
import { onDestroy } from 'svelte';
import type { AnchorWatch } from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import {
  DEPTH_SOURCE_LABELS,
  DEPTH_SOURCE_TITLES,
  type DepthReading,
  type OwnVessel,
} from '$entities/vessel';
import { AutopilotChip } from '$features/autopilot';
import { type MenuItem, PinnedActions } from '$features/menu';
import { type AlarmAudioState, alarmAudioNote } from '$shared/audio';
import {
  createMediaQuery,
  formatBearingOr,
  formatClockTime,
  formatLatitude,
  formatLengthOr,
  formatLongitude,
  formatMetersOrNm,
  formatSpeedOr,
  lengthUnit,
  NARROW_QUERY,
  type ReactiveClock,
  speedUnit,
  Toast,
} from '$shared/lib';
import { COG_MIN_SOG_MPS } from '$shared/nav';
import { type ConnectionPhase, isConnectionDown } from '$shared/signalk';
import { TransientNote } from '$shared/ui';
import { spanColumns } from './span-columns';

let {
  connectionLabel,
  connectionTitle = '',
  streamError,
  dataStalled = false,
  online,
  fixStale,
  gpsNeverReceived = false,
  connectionPhase,
  aisCount,
  aisUnassessed = 0,
  aisOwnFixLost = false,
  aisNearestUnassessed = undefined,
  navigating = false,
  anchor,
  units,
  vessel,
  shallowAlarming,
  shallowState = 'monitoring',
  radarHealth = { state: 'quiet' },
  autopilotChip = undefined,
  onOpenAutopilot = undefined,
  weatherWarning = undefined,
  alertCount = 0,
  onOpenAlarms = undefined,
  soundOff = undefined,
  orientation = undefined,
  onResetOrientation = undefined,
  pinnedActions,
  editing = false,
  clock,
  onReconnect,
  onOpenHelp = undefined,
  onOpenAnchor = undefined,
}: {
  connectionLabel: string;
  // The fuller diagnosis behind the conn dot's short label, shown on hover and on a dot tap.
  connectionTitle?: string;
  streamError: boolean;
  dataStalled?: boolean;
  online: boolean;
  fixStale: boolean;
  // Connected with no position EVER received (past the startup grace): a different answer from
  // fixStale, which is a fix that was had and lost.
  gpsNeverReceived?: boolean;
  connectionPhase: ConnectionPhase;
  aisCount: number;
  // Retained targets the lookout cannot assess (course or motion missing), the persistent
  // degraded-assessment cue a watch handoff must be able to see at a glance.
  aisUnassessed?: number;
  // The degrade is the boat's own fix, not the targets' data; the cell names the real cause.
  aisOwnFixLost?: boolean;
  // The closest unassessed contact, so the cell can say how near the nearest unknown is.
  aisNearestUnassessed?: { id: string; name?: string; rangeMeters: number };
  // Whether a course is active, which prioritizes COG in the compact readout set.
  navigating?: boolean;
  anchor: AnchorWatch;
  units: UnitsStore;
  vessel: OwnVessel;
  shallowAlarming: boolean;
  // The shallow watch's honest state: any nonmonitoring grade names the pause instead of showing
  // a bare Depth placeholder.
  shallowState?: import('$features/lookout').ShallowMonitorState;
  // Helm-visible radar health: failure and staleness stay visible with Radar Controls closed.
  radarHealth?: import('$features/marine-radar').RadarHelmHealth;
  // The autopilot cell state; renders nothing while hidden. A door to the Autopilot panel.
  autopilotChip?: import('$features/autopilot').AutopilotChipState;
  onOpenAutopilot?: () => void;
  // The worst active provider weather warning (for example "Gale Warning"), the closed-panel cue;
  // a tap explains and points at the weather panel. Absent when no warning is in effect.
  weatherWarning?: string;
  // Raised alerts below the alarm grades, which sound nothing and raise no strip: the count is the
  // only chart-screen trace of them. A door to the Alarms panel.
  alertCount?: number;
  onOpenAlarms?: () => void;
  // The alarm audio gate while a watch is armed and this display cannot sound it; undefined hides
  // the notice. App's global listener primes audio on any tap, so Enable only has to explain; a
  // blocked gate clears on it and the notice leaves once the gate reads ready.
  soundOff?: AlarmAudioState;
  // The chart orientation while a rotating mode is chosen: what the chart is doing (shown), the
  // reference driving it, and the full label naming any fallback to north. One tap on the cell
  // returns to north up. Absent in the default north-up mode, where an unrotated chart speaks for
  // itself.
  orientation?: { label: string; active: boolean; shown: string; reference?: string };
  onResetOrientation?: () => void;
  pinnedActions: MenuItem[];
  editing?: boolean;
  clock: ReactiveClock;
  onReconnect: () => void;
  // Opens the Help panel from the Waiting for GPS notice, where the fix lives in prose.
  onOpenHelp?: () => void;
  // Opens the Anchor watch panel: overnight the cell is the monitoring surface, so it is a door.
  onOpenAnchor?: () => void;
} = $props();

const connectionDown = $derived(isConnectionDown(connectionPhase));

// Explanations for the degraded readouts live in title attributes, and titles are dead on touch:
// tapping an explanatory cell or notice shows the same text as a transient note above the strip.
const chipNote = new Toast();
const CHIP_NOTE_MS = 5_000;
onDestroy(() => chipNote.dispose());

// While the Signal K link itself is down or silent, the per-sensor consequences (No GPS fix,
// dashed SOG, COG, and HDG, the paused depth watch) are one failure with one action, Reconnect.
// Subordinating them keeps the strip presenting that one failure instead of five. Radar is
// deliberately excluded: its picture rides the radar provider's own stream, not this link.
const linkDown = $derived(connectionDown || dataStalled || streamError);

const connTitle = $derived(connectionTitle || connectionLabel);

// The tap itself is the fix: App's global listener primes audio on any gesture, so Enable and Try
// again need no handler of their own. A blocked gate clears on the tap and the notice leaves; a
// failed device may not come back, so that tap also says why. Unsupported has no action at all,
// only the explanation.
function explainSoundOff(): void {
  const note = soundOff === undefined ? undefined : alarmAudioNote(soundOff);
  if (note) chipNote.show(note, CHIP_NOTE_MS);
}
const aisTitle = $derived.by(() => {
  if (aisUnassessed === 0) return 'AIS targets being watched for collision risk';
  const cause = aisOwnFixLost
    ? `own GPS fix lost or stale, so ${aisUnassessed} targets cannot be assessed`
    : `${aisUnassessed} cannot be assessed because course or motion data is missing or stale`;
  const nearest = aisNearestUnassessed
    ? `; nearest unknown ${formatMetersOrNm(aisNearestUnassessed.rangeMeters, units.profile)} away`
    : '';
  return `AIS targets being watched for collision risk; ${cause}${nearest}`;
});
const radarTitle = $derived.by(() => {
  if (radarHealth.state !== 'failed') {
    return 'Radar is transmitting but no fresh echo frames are arriving';
  }
  return radarHealth.reason === 'renderer'
    ? 'Radar is transmitting but the echo display failed on this device; open Radar controls'
    : 'Radar is transmitting but its data stream failed; open Radar controls';
});

// The phone-width strip carries a bounded, context-prioritized readout set instead of hiding COG,
// heading, and AIS with fixed CSS: underway or navigating, COG is the course reference, and a boat
// with only a compass shows HDG. A phone carries no AIS cell, so degraded assessment there goes on
// the caution line rather than inserting a cell that would shift every readout at the moment a
// hazard is reported; it must never disappear just because the screen is narrow. Wide layouts show
// everything.
const compactQuery = createMediaQuery(NARROW_QUERY);
const compact = $derived(compactQuery.matches);
const underway = $derived(!vessel.sogStale && (vessel.sogMps ?? 0) >= COG_MIN_SOG_MPS);
const showCog = $derived(!compact || navigating || underway);
const showHdg = $derived(
  !compact || (!showCog && !vessel.headingStale && vessel.headingRad !== undefined),
);
const lookoutOpen = $derived(connectionPhase === 'open');
const showLookout = $derived(lookoutOpen && !compact);
const aisNotice = $derived(
  lookoutOpen && compact && aisUnassessed > 0
    ? `${aisUnassessed} AIS ${aisUnassessed === 1 ? 'target' : 'targets'} unassessed`
    : undefined,
);

const depth = $derived(vessel.safetyDepth);

// A stale fix with retained coordinates: shown as "Last fix" with its age, never as current.
const retainedFix = $derived(fixStale && vessel.position !== undefined);
const positionLabel = $derived.by(() => {
  if (!retainedFix) return 'Vessel';
  const epoch = vessel.positionEpochMs;
  if (epoch === undefined) return 'Last fix';
  const seconds = Math.max(0, Math.round((clock.now - epoch) / 1000));
  return `Last fix · ${seconds < 90 ? `${seconds} s ago` : `${Math.round(seconds / 60)} min ago`}`;
});
// The degrees ride the value line at the data size and the hemisphere at the unit size, set close
// as 42.6154°N, so the two coordinates fit the position's two columns.
function coordinateParts(text: string): [string, string] {
  const space = text.lastIndexOf(' ');
  return space < 0 ? [text, ''] : [text.slice(0, space), text.slice(space + 1)];
}
const latitude = $derived(coordinateParts(formatLatitude(vessel.position?.latitude)));
const longitude = $derived(coordinateParts(formatLongitude(vessel.position?.longitude)));

// The depth cell's hover and accessible title, one branch per state, so the template stays flat.
function depthTitle(reading: DepthReading, alarming: boolean): string {
  if (shallowState === 'stale' || reading.stale)
    return 'Depth data is stale; the shallow watch is paused';
  if (shallowState === 'no-reading')
    return 'The depth source is streaming unusable readings; the shallow watch is paused';
  if (shallowState === 'no-source')
    return 'No depth source is publishing; the shallow watch cannot monitor';
  if (alarming) return 'Shallow water: depth below the alarm threshold';
  if (reading.source) return DEPTH_SOURCE_TITLES[reading.source];
  return 'No depth source is publishing';
}
// A boat that never had a depth source keeps the plain label with the placeholder value (nothing
// was ever watching, so there is no pause to name, and the title carries the explanation); the
// degraded states that interrupt an active watch say Paused in place of the value, and a tap names
// the cause.
const depthWatchPaused = $derived(
  shallowState === 'stale' || shallowState === 'no-reading' || depth.stale,
);

// The optional readouts own fixed spare columns on the helm row, so one appearing never moves
// another: chart orientation (a standing setting) the first, the anchor watch the second, and the
// autopilot the second unless the anchor holds it, when it takes the Time column and Time steps
// aside. Stacked layouts place them in reading order.
const showAutopilot = $derived(
  autopilotChip !== undefined && autopilotChip.kind !== 'hidden' && onOpenAutopilot !== undefined,
);
const autopilotSlot = $derived(anchor.watching ? 'slot-extra-3' : 'slot-extra-2');
// One string, so the label and its reference cannot be split by a reflow into two spaces.
const orientationLabel = $derived(
  orientation?.reference ? `Chart · ${orientation.reference}` : 'Chart',
);

const alertText = $derived(`${alertCount} ${alertCount === 1 ? 'alert' : 'alerts'}`);
const weatherTitle = $derived(`Weather warning: ${weatherWarning}. Open Weather for details.`);
const radarText = $derived(
  radarHealth.state === 'stale'
    ? 'Radar stale'
    : radarHealth.state === 'failed' && radarHealth.reason === 'renderer'
      ? 'Radar display failed'
      : 'Radar stream failed',
);
</script>

<!-- A caution-line item spanning whole columns of the readout grid: an icon, the words, and the one
     action that fixes it, when there is one. -->
{#snippet notice(
  text: string,
  options: {
    cls?: string;
    title?: string;
    live?: boolean;
    mute?: boolean;
    action?: string;
    onAction?: () => void;
  } = {},
)}
  <span
    class="notice {options.cls ?? ''}"
    title={options.title}
    role={options.live ? 'status' : undefined}
    aria-live={options.live ? 'polite' : undefined}
    use:spanColumns
  >
    <span class="notice-body">
      {#if options.mute}
        <VolumeX size={16} aria-hidden="true" />
      {:else}
        <TriangleAlert size={16} aria-hidden="true" />
      {/if}
      {text}
      {#if options.action && options.onAction}
        <button type="button" class="btn btn-compact" onclick={options.onAction}>
          {options.action}
        </button>
      {/if}
    </span>
  </span>
{/snippet}

<!-- A caution-line item that is itself the tap: an explanation, or a door to its panel. -->
{#snippet tapNotice(
  text: string,
  onTap: () => void,
  options: { cls?: string; title?: string; label?: string; live?: boolean; mute?: boolean } = {},
)}
  <button
    type="button"
    class="notice {options.cls ?? ''}"
    title={options.title}
    aria-label={options.label}
    onclick={onTap}
    use:spanColumns
  >
    <span class="notice-body">
      {#if options.mute}
        <VolumeX size={16} aria-hidden="true" />
      {:else}
        <TriangleAlert size={16} aria-hidden="true" />
      {/if}
      {#if options.live}
        <span role="status" aria-live="polite">{text}</span>
      {:else}
        {text}
      {/if}
    </span>
  </button>
{/snippet}

<!-- A motion readout: a value and its unit, in the caution voice while its source is lost, and
     subordinated with a dashed underline while the link itself is down. -->
{#snippet motionCell(
  cls: string,
  label: string,
  title: string,
  value: string,
  unit: string,
  warning: boolean,
)}
  <span
    class="data-cell {cls}"
    class:data-cell--warning={warning}
    class:subordinate={linkDown}
    class:stale-cue={linkDown}
    {title}
  >
    <span class="data-cell-label">{label}</span>
    <span class="data-cell-value"><b class="num">{value}</b> <span>{unit}</span></span>
  </span>
{/snippet}

<footer class="status-strip" class:editing>
  <div class="strip-grid">
    <!-- The caution line: every problem that is not one readout's own, each item snapping to whole
         columns of the readout grid below so the two rows share the same edges. It takes no space
         while nothing is wrong. -->
    <div class="strip-notices">
      {#if streamError}
        <!-- Not a live region: the always-mounted conn dot announces every connection phase
             politely, and the one assertive channel is App's annunciator, which a data-link note
             must not talk over. -->
        {@render notice('Data link failed', {
          cls: 'connection-action',
          action: 'Retry',
          onAction: onReconnect,
        })}
      {:else if connectionDown || dataStalled}
        <!-- A down socket, or one that is open but silent (a stop the per-cell staleness dashes
             never name; connectionLabel already says which). Not a live region: the conn dot
             announces every phase, and a second region carrying the same label announced the drop
             twice. This is the sighted half. -->
        {@render notice(connectionLabel, {
          cls: 'connection-action',
          title: 'Readouts pause until data returns',
          action: 'Reconnect',
          onAction: onReconnect,
        })}
      {/if}
      {#if !online}
        {@render notice('Offline', { cls: 'offline', live: true })}
      {/if}
      {#if fixStale}
        {@render notice('No GPS fix', {
          cls: linkDown ? 'fix-notice subordinate' : 'fix-notice',
          live: true,
        })}
      {:else if gpsNeverReceived}
        <!-- Connected, but no position has ever arrived: without this the strip looks healthy while
             every position-dependent feature silently waits. -->
        {@render notice('Waiting for GPS', {
          cls: 'fix-notice',
          live: true,
          title:
            "Connected, but the server has not published a GPS position. Check the GPS source in the Signal K server's Data Browser, or open Help.",
          action: onOpenHelp ? 'Help' : undefined,
          onAction: onOpenHelp,
        })}
      {/if}
      {#if aisNotice}
        {@render tapNotice(aisNotice, () => chipNote.show(aisTitle, CHIP_NOTE_MS), {
          cls: 'lookout-notice',
          title: aisTitle,
        })}
      {/if}
      {#if orientation && !orientation.active}
        <!-- The Chart cell says north up in the caution voice; the full label names why the chosen
             rotation fell back. -->
        {@render notice(orientation.label, { cls: 'orientation-notice' })}
      {/if}
      {#if weatherWarning}
        {@render tapNotice(weatherWarning, () => chipNote.show(weatherTitle, CHIP_NOTE_MS), {
          title: weatherTitle,
        })}
      {/if}
      {#if soundOff === 'blocked'}
        {@render notice('Alarm sound off', {
          cls: 'sound-off-notice',
          title: alarmAudioNote(soundOff),
          mute: true,
          action: 'Enable',
          onAction: () => {},
        })}
      {:else if soundOff === 'failed'}
        {@render notice('Alarm sound failed', {
          cls: 'sound-off-notice',
          title: alarmAudioNote(soundOff),
          mute: true,
          action: 'Try again',
          onAction: explainSoundOff,
        })}
      {:else if soundOff === 'unsupported'}
        {@render tapNotice('Alarm sound unavailable', explainSoundOff, {
          cls: 'sound-off-notice',
          title: alarmAudioNote(soundOff),
          mute: true,
        })}
      {/if}
      {#if alertCount > 0 && onOpenAlarms}
        {@render tapNotice(alertText, onOpenAlarms, {
          cls: 'alerts-notice',
          label: `${alertText}, open Alarms`,
        })}
      {/if}
      {#if radarHealth.state !== 'quiet'}
        <!-- Radar trouble stays visible with Radar Controls closed: the picture the helm relies on
             has quietly stopped, which the panel alone cannot say. role=status announces once. -->
        {@render tapNotice(radarText, () => chipNote.show(radarTitle, CHIP_NOTE_MS), {
          cls: radarHealth.state === 'failed' ? 'radar-notice offline' : 'radar-notice',
          title: radarTitle,
          live: true,
        })}
      {/if}
    </div>
    <button
      type="button"
      class="conn"
      class:conn--down={connectionDown || dataStalled}
      title={connTitle}
      onclick={() => chipNote.show(connTitle, CHIP_NOTE_MS)}
    >
      <span class="conn-live" role="status" aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>
        <span class="visually-hidden">{connectionLabel}</span>
      </span>
    </button>
    <div class="strip-readouts">
      {#if showLookout}
        <button
          type="button"
          class="data-cell lookout slot-ais"
          title={aisTitle}
          onclick={() => chipNote.show(aisTitle, CHIP_NOTE_MS)}
        >
          <span class="data-cell-label">
            {#if aisUnassessed > 0}
              <TriangleAlert size={12} aria-hidden="true" class="sev-warning" />
            {/if}
            AIS
          </span>
          <span class="data-cell-value">
            <b class="num">{aisCount}</b>
            {#if aisUnassessed > 0}
              <span class="data-cell-qualifier sev-warning">{aisUnassessed} unassessed</span>
            {/if}
          </span>
        </button>
      {/if}
      {@render motionCell(
        'sog-readout slot-sog',
        'SOG',
        'Speed over ground',
        formatSpeedOr(fixStale || vessel.sogStale ? undefined : vessel.sogMps, units.profile),
        speedUnit(units.profile),
        fixStale || vessel.sogStale,
      )}
      {#if showCog}
        {@render motionCell(
          'cog-readout slot-cog',
          'COG',
          'Course over ground',
          formatBearingOr(
            fixStale || vessel.cogStale || (vessel.sogMps ?? 0) < COG_MIN_SOG_MPS
              ? undefined
              : vessel.cogRad,
          ),
          '°T',
          fixStale || vessel.cogStale,
        )}
      {/if}
      {#if showHdg}
        {@render motionCell(
          'hdg-readout slot-hdg',
          'HDG',
          'Heading, true',
          formatBearingOr(vessel.headingStale ? undefined : vessel.headingRad),
          '°T',
          vessel.headingStale,
        )}
      {/if}
      <button
        type="button"
        class="data-cell depth-readout slot-depth"
        class:data-cell--alarm={shallowAlarming}
        class:data-cell--warning={!shallowAlarming &&
          (depth.stale || shallowState !== 'monitoring')}
        class:subordinate={linkDown && !shallowAlarming}
        class:stale-cue={linkDown && !shallowAlarming}
        title={depthTitle(depth, shallowAlarming)}
        onclick={() => chipNote.show(depthTitle(depth, shallowAlarming), CHIP_NOTE_MS)}
      >
        <span class="data-cell-label">
          {#if shallowAlarming || depthWatchPaused}
            <TriangleAlert size={12} aria-hidden="true" />
          {/if}
          {shallowAlarming ? 'Shallow' : 'Depth'}
        </span>
        <span class="data-cell-value">
          {#if depthWatchPaused}
            <span class="word">Paused</span>
          {:else}
            <b class="num">{formatLengthOr(depth.stale ? undefined : depth.meters, units.mode)}</b>
            <span>{lengthUnit(units.mode)}</span>
            {#if depth.source}
              <span class="data-cell-qualifier datum">{DEPTH_SOURCE_LABELS[depth.source]}</span>
            {/if}
          {/if}
        </span>
      </button>
      {#if orientation}
        <!-- The cell is its own action: one tap returns the chart to north up. The shown mode is a
             live region, so a fallback to north is announced as well as drawn. -->
        <button
          type="button"
          class="data-cell orientation-readout slot-extra-1"
          class:data-cell--warning={!orientation.active}
          title="Chart orientation: {orientation.label}. Tap to return to north up."
          onclick={onResetOrientation}
        >
          <span class="data-cell-label">
            {#if !orientation.active}
              <TriangleAlert size={12} aria-hidden="true" />
            {/if}
            {orientationLabel}
          </span>
          <span class="data-cell-value">
            <span class="word" role="status" aria-live="polite">{orientation.shown}</span>
            <span class="visually-hidden">, return to north up</span>
          </span>
        </button>
      {/if}
      {#if anchor.watching}
        <!-- Named by its content, never a masking label: the alarm cue (No GPS, distance over
             radius) must reach assistive tech; the open-panel action lives in the title. -->
        <button
          type="button"
          class="data-cell anchor-readout slot-extra-2"
          class:data-cell--alarm={anchor.dragging || anchor.fixLost}
          title={anchor.fixLost
            ? 'Anchor watch: no GPS fix, drag detection degraded. Opens Anchor watch.'
            : 'Anchor watch: distance from the anchor over the watch radius. Opens Anchor watch.'}
          onclick={onOpenAnchor}
        >
          <span class="data-cell-label">
            {#if anchor.dragging || anchor.fixLost}
              <TriangleAlert size={12} aria-hidden="true" />
            {/if}
            Anchor
          </span>
          <span class="data-cell-value">
            {#if anchor.fixLost}
              <span class="word">No GPS</span>
            {:else}
              <b class="num">{formatLengthOr(anchor.distanceMeters, units.mode, 0)}</b>
              <span>/</span>
              <b class="num">{formatLengthOr(anchor.radiusMeters, units.mode, 0)}</b>
              <span>{lengthUnit(units.mode)}</span>
            {/if}
          </span>
        </button>
      {/if}
      {#if showAutopilot && autopilotChip && onOpenAutopilot}
        <AutopilotChip chip={autopilotChip} onOpen={onOpenAutopilot} cellClass={autopilotSlot} />
      {/if}
      <!-- A stale fix never wears current-position styling: the label says what the coordinates
           are (the last fix and its age), in the same caution treatment as the dashed readouts. -->
      <span
        class="data-cell data-cell--wide position-readout slot-position"
        class:data-cell--warning={retainedFix}
        title={retainedFix ? 'Last known position; the GPS fix is stale' : 'Vessel position'}
      >
        <span class="data-cell-label">{positionLabel}</span>
        <span class="data-cell-value">
          <span class="coordinate"><b class="num">{latitude[0]}</b>{latitude[1]}</span>
          <span class="coordinate"><b class="num">{longitude[0]}</b>{longitude[1]}</span>
        </span>
      </span>
      <span class="data-cell time-readout slot-time" title="Local time">
        <span class="data-cell-label">Time</span>
        <span class="data-cell-value"><b class="num">{formatClockTime(clock.now)}</b></span>
      </span>
    </div>
    <PinnedActions actions={pinnedActions} />
  </div>
  <TransientNote message={chipNote.message} noteClass="chip-note" />
</footer>

<style>
/* The status bar is one grid of equal columns, the bar's design rule: every readout is one column
   (the vessel position two), every pinned action is one column, labels share one line and values
   share one baseline across the bar (the .data-cell vocabulary in data-cells.css), and the caution
   line snaps to the same column edges. Three layouts, one rule:
   - Stacked, the default: the readouts fill a wrapping grid of equal columns, at least
     --strip-cell-min wide, with the pinned tiles on their own row beneath.
   - Helm row, once the strip holds fourteen columns: five instrument columns, four tile columns at
     the true center, and five more columns (two spare for the optional readouts, then position and
     time), all on one row. Focus follows that visual order (reading-flow), not the source order.
   - Sideways phone: the readouts beside icon tiles on one row, while there is room for three
     readout columns. */
.status-strip {
  /* The query container for the helm row below. */
  container: status-strip / inline-size;
  --strip-gutter: 1rem;
  /* The stacked grid's column floor: two hold the vessel position. */
  --strip-cell-min: var(--data-cell-min);
  padding: var(--space-2) 0.5rem;
  padding-block-end: calc(var(--space-2) + var(--system-bar-clearance));
  padding-inline-start: calc(0.5rem + env(safe-area-inset-left, 0px));
  padding-inline-end: calc(0.5rem + env(safe-area-inset-right, 0px));
  border-block-start: 1px solid var(--border);
  color: var(--text-muted);
  font-size: var(--text-md);
  /* The positioning context for the cell-tap note, which floats above the strip. */
  position: relative;
}
/* The bar's half of the two-part pin/unpin interaction (the app menu's tiles are the other half):
   a static accent edge, not animated, so the navigator sees this row is part of an active editing
   session without added motion at the helm. */
.status-strip.editing {
  border-block-start-color: var(--accent);
}
.strip-grid {
  display: grid;
  /* The connection dot's gutter, the readouts, and a matching gutter, so the readouts and the
     caution line share one left edge and the helm row's tiles sit at the true center. */
  grid-template-columns: var(--strip-gutter) minmax(0, 1fr) var(--strip-gutter);
}
.strip-notices,
.strip-readouts {
  grid-column: 2;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--strip-cell-min), 1fr));
}
.strip-notices {
  grid-row: 1;
  /* Each notice sizes its content against the line's own width. */
  container-type: inline-size;
}
.strip-notices:not(:has(.notice)) {
  display: none;
}
.strip-readouts {
  grid-row: 2;
}
.strip-grid > :global(.pinned-actions) {
  grid-column: 1 / -1;
  grid-row: 3;
  margin-block-start: var(--space-1);
}
/* A notice is a grid item spanning whole columns (spanColumns); its body is its max-content. */
.notice {
  display: flex;
  align-items: center;
  min-inline-size: 0;
  min-block-size: var(--control-size);
  padding: 0 0.35rem;
  border: 0;
  background: none;
  color: var(--warning);
  font: inherit;
  font-weight: 600;
  text-align: start;
}
button.notice {
  cursor: pointer;
}
.notice-body {
  display: inline-flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  inline-size: max-content;
  max-inline-size: 100cqi;
}
.notice-body :global(svg) {
  flex: none;
}
.notice-body .btn {
  font-weight: 400;
}
.offline {
  color: var(--alarm);
}
/* The connection dot: the healthy state spends no strip space on the word "Connected" (the label
   stays for assistive tech and the hover title); a drop turns the dot the caution color, and the
   caution line carries the visible label and its action. */
.conn {
  grid-column: 1;
  grid-row: 2;
  align-self: start;
  display: inline-flex;
  align-items: center;
  block-size: var(--control-size);
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.conn-live {
  display: inline-flex;
  align-items: center;
}
.status-dot {
  inline-size: 0.6rem;
  block-size: 0.6rem;
  border-radius: 50%;
  background: var(--dot-color, var(--ok));
}
.conn--down .status-dot {
  --dot-color: var(--warning);
}
/* The cell-tap note floats above the strip, lifted over any safety rail by the shared clearance
   variable and layered below the safety strips so it can never cover a safety card. */
:global(.chip-note) {
  inset-block-end: calc(100% + var(--rail-clearance, 0px) + var(--space-1));
  z-index: calc(var(--z-safety-strips) - 1);
  max-inline-size: min(22rem, calc(100vw - 2 * var(--space-3)));
  font-size: var(--text-sm);
}
/* The datum tag names which depth reference the number is (keel, surface, or transducer), so the
   strip and an instruments tile showing different depths on one screen explain themselves. */
.datum {
  margin-inline-start: 0.2rem;
}
.coordinate {
  display: inline-flex;
  align-items: baseline;
}
.coordinate + .coordinate {
  margin-inline-start: 0.25rem;
}
/* Subordinated consequence readouts while the link itself is the failure remain readable. This sits
   after the warning rules so color, rather than opacity, preserves contrast for both the label and
   its value. */
.subordinate,
.subordinate :global(.num),
.subordinate :global(.word) {
  color: var(--text-subordinate);
}
/* On a phone or small tablet the position and time readouts leave the strip: any watch or phone
   shows the time, and the Position instrument tile covers the position on demand. With no
   two-column position to hold, the columns may narrow to one single-value readout, so a 360 px
   phone keeps SOG, COG, and Depth on one row. */
@media (max-width: 900px) {
  .status-strip {
    --strip-cell-min: 5.75rem;
  }
  .slot-position,
  .slot-time {
    display: none;
  }
}
@media (max-width: 600px) {
  .status-strip {
    --strip-gutter: 0.75rem;
  }
}
/* Very large text on a narrow phone, where not even two readout columns fit: a column of one
   readout per row would stack the strip taller than the chart can spare and push a safety strip off
   the screen. The cells set their label beside the value instead, at the physical 44 px target
   floor, and wrap as whole items. Two of the narrow columns plus the gutters, in rem, so it only
   ever applies at enlarged text. */
@container status-strip (max-width: 13rem) {
  .strip-grid {
    margin-block: calc(-1 * var(--space-1));
  }
  .strip-readouts {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--space-3);
  }
  .strip-readouts :global(.data-cell-value) {
    line-height: 1.2;
  }
  .strip-readouts > :global(.data-cell) {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    block-size: auto;
    min-block-size: 44px;
    border-inline-start: 0;
  }
  .strip-readouts > :global(.data-cell) > :global(.data-cell-label) {
    flex: none;
  }
  /* Restated at the display rule's own specificity: this only ever applies on a phone, where
     they leave. */
  .strip-readouts > .slot-position,
  .strip-readouts > .slot-time {
    display: none;
  }
}
/* A phone held sideways has the width for one row but not the height for two: the readouts take the
   leading space and the icon tiles the trailing edge, so the chart keeps the height a stacked strip
   would spend. Only while three readout columns fit beside the tiles, in the strip's own rem, so at
   very large text the tiles drop back onto their own row and the readouts keep the full width. */
@media (orientation: landscape) and (max-height: 500px) and (max-width: 1000px) {
  .slot-position,
  .slot-time {
    display: none;
  }
  @container status-strip (min-width: 34rem) {
    .strip-grid {
      grid-template-columns: var(--strip-gutter) minmax(0, 1fr) auto;
    }
    .strip-grid > :global(.pinned-actions) {
      grid-column: 3;
      grid-row: 2;
      align-self: start;
      margin-block-start: 0;
    }
  }
}
/* The helm row: fourteen equal columns between the gutters, about 1,580 px at the default text
   size. Five instrument columns, four tile columns at the true center, then two spare columns for
   the optional readouts, two for the position, and one for the time. Fourteen --data-cell-min
   columns plus the two gutters; change the three together. */
@container status-strip (min-width: 98.6rem) {
  .strip-grid {
    grid-template-columns: var(--strip-gutter) repeat(14, minmax(0, 1fr)) var(--strip-gutter);
    reading-flow: grid-rows;
  }
  .strip-notices {
    grid-column: 2 / -2;
    grid-template-columns: repeat(14, minmax(0, 1fr));
  }
  .strip-readouts {
    display: contents;
  }
  .strip-readouts > :global(*) {
    grid-row: 2;
  }
  .slot-ais {
    grid-column: 2;
  }
  .slot-sog {
    grid-column: 3;
  }
  .slot-cog {
    grid-column: 4;
  }
  .slot-hdg {
    grid-column: 5;
  }
  .slot-depth {
    grid-column: 6;
  }
  .strip-grid > :global(.pinned-actions) {
    grid-column: 7 / span 4;
    grid-row: 2;
    margin-block-start: 0;
    --bar-capacity: 4;
    --bar-tile-column: 25%;
    --bar-tile-gap: 0;
    --bar-tile-inset: var(--space-1);
    /* Fewer than four tiles start at the first tile column, so every tile edge stays on the grid. */
    --bar-tile-justify: start;
  }
  .slot-extra-1 {
    grid-column: 11;
  }
  .strip-readouts > :global(.slot-extra-2) {
    grid-column: 12;
  }
  .slot-position {
    grid-column: 13 / span 2;
  }
  /* A divider only between two filled neighboring columns: never beside the tiles or an empty
     spare column. */
  .slot-extra-1,
  .strip-readouts:not(:has(.slot-extra-1)) > :global(.slot-extra-2),
  .strip-readouts:not(:has(:global(.slot-extra-2))) .slot-position {
    border-inline-start: 0;
  }
  .slot-time,
  .strip-readouts > :global(.slot-extra-3) {
    grid-column: 15;
  }
  .strip-readouts:has(:global(.slot-extra-3)) .slot-time {
    display: none;
  }
}
</style>

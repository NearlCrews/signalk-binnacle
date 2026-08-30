<script lang="ts">
import { onDestroy } from 'svelte';
import type { AnchorWatch } from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import {
  DEPTH_SOURCE_LABELS,
  DEPTH_SOURCE_TITLES,
  type DepthReading,
  type OwnVessel,
} from '$entities/vessel';
import { type MenuItem, PinnedActions } from '$features/menu';
import {
  createMediaQuery,
  formatBearingOr,
  formatClockTime,
  formatLatitude,
  formatLengthOr,
  formatLongitude,
  formatSpeedOr,
  lengthUnit,
  type ReactiveClock,
  speedUnit,
  Toast,
} from '$shared/lib';
import { type ConnectionPhase, isConnectionDown } from '$shared/signalk';
import { TransientNote } from '$shared/ui';

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
  navigating = false,
  anchor,
  units,
  vessel,
  shallowAlarming,
  shallowState = 'monitoring',
  radarHealth = { state: 'quiet' },
  weatherWarning = undefined,
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
  // The fuller diagnosis behind the conn chip's short label, shown on hover and on a chip tap.
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
  // The worst active provider weather warning (for example "Gale Warning"), the closed-panel cue;
  // a tap explains and points at the weather panel. Absent when no warning is in effect.
  weatherWarning?: string;
  // The chart orientation while a rotating mode is chosen: its live label (including a fallback to
  // north when the reference is stale) stays visible, and one tap returns to north-up. Absent in
  // the default north-up mode, where an unrotated chart speaks for itself.
  orientation?: { label: string; active: boolean };
  onResetOrientation?: () => void;
  pinnedActions: MenuItem[];
  editing?: boolean;
  clock: ReactiveClock;
  onReconnect: () => void;
  // Opens the Help panel from the Waiting-for-GPS chip, where the fix lives in prose.
  onOpenHelp?: () => void;
  // Opens the Anchor watch panel: overnight the chip is the monitoring surface, so it is a door.
  onOpenAnchor?: () => void;
} = $props();

// COG is meaningless while the boat is stationary; under this speed the readout dashes.
const COG_MIN_SOG_MPS = 0.15;

const connectionDown = $derived(isConnectionDown(connectionPhase));

// Explanations for the degraded chips live in title attributes, and titles are dead on touch:
// tapping an explanatory chip shows the same text as a transient note above the strip.
const chipNote = new Toast();
const CHIP_NOTE_MS = 5_000;
onDestroy(() => chipNote.dispose());

// While the Signal K link itself is down or silent, the per-sensor consequences (No GPS fix,
// dashed SOG, COG, and HDG, the paused depth watch) are one failure with one action, Reconnect.
// Subordinating them keeps the strip presenting that one failure instead of five. Radar is
// deliberately excluded: its picture rides the radar provider's own stream, not this link.
const linkDown = $derived(connectionDown || dataStalled || streamError);

const connTitle = $derived(connectionTitle || connectionLabel);
const aisTitle = $derived(
  aisUnassessed > 0
    ? `AIS targets being watched for collision risk; ${aisUnassessed} cannot be assessed because course or motion data is missing or stale`
    : 'AIS targets being watched for collision risk',
);
const radarTitle = $derived.by(() => {
  if (radarHealth.state !== 'failed') {
    return 'Radar is transmitting but no fresh echo frames are arriving';
  }
  return radarHealth.reason === 'renderer'
    ? 'Radar is transmitting but the echo display failed on this device; open Radar controls'
    : 'Radar is transmitting but its data stream failed; open Radar controls';
});

// The phone-width strip carries a bounded, context-prioritized readout set instead of hiding COG,
// heading, and AIS with fixed CSS: underway or navigating, COG is the course reference; a boat
// with only a compass shows HDG; and the AIS chip stays whenever assessment is degraded, because
// that state must never disappear just because the screen is narrow. Wide layouts show everything.
const compactQuery = createMediaQuery('(max-width: 600px)');
const compact = $derived(compactQuery.matches);
const underway = $derived(!vessel.sogStale && (vessel.sogMps ?? 0) >= COG_MIN_SOG_MPS);
const showCog = $derived(!compact || navigating || underway);
const showHdg = $derived(
  !compact || (!showCog && !vessel.headingStale && vessel.headingRad !== undefined),
);
const showLookout = $derived(connectionPhase === 'open' && (!compact || aisUnassessed > 0));

const depth = $derived(vessel.safetyDepth);

// A stale fix with retained coordinates: shown as "Last fix" with its age, never as current.
const retainedFix = $derived(fixStale && vessel.position !== undefined);
const fixAgeText = $derived.by(() => {
  const epoch = vessel.positionEpochMs;
  if (epoch === undefined) return '';
  const seconds = Math.max(0, Math.round((clock.now - epoch) / 1000));
  return seconds < 90 ? `${seconds} s ago` : `${Math.round(seconds / 60)} min ago`;
});

// The depth chip's hover and accessible title, one branch per state, so the template stays flat.
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

// The depth chip's visible label: a nonmonitoring watch says so instead of a bare placeholder.
// A boat that never had a depth source keeps the plain label with the placeholder value (nothing
// was ever watching, so there is no pause to name, and the title carries the explanation); the
// degraded states that interrupt an active watch name the pause visibly.
const depthLabel = $derived.by(() => {
  if (shallowAlarming) return 'Shallow';
  if (shallowState === 'stale' || depth.stale) return 'Depth stale, watch paused';
  if (shallowState === 'no-reading') return 'Depth unavailable, watch paused';
  return 'Depth';
});
// While the watch is paused, the label carries the whole message; a dashed value and datum tag
// beside "Depth stale, watch paused" add nine characters of nothing, exactly where a degraded
// strip is already at its widest.
const depthWatchPaused = $derived(
  shallowState === 'stale' || shallowState === 'no-reading' || depth.stale,
);
</script>

<footer class="status-strip" class:editing>
  <div class="strip-start">
    <button
      type="button"
      class="conn chip-btn"
      class:conn--down={connectionDown || dataStalled}
      title={connTitle}
      onclick={() => chipNote.show(connTitle, CHIP_NOTE_MS)}
    >
      <span class="conn-live" role="status" aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>
        <span class="visually-hidden">{connectionLabel}</span>
      </span>
    </button>
    {#if streamError}
      <!-- Not a live region: the always-mounted conn dot above announces every connection phase
           politely (matching the down branch below), and the one assertive channel is App's
           annunciator, which a data-link note must not talk over. -->
      <span class="readout fix-lost action-note action-note--wrap connection-action">
        Data link failed
        <button type="button" class="btn btn-compact" onclick={onReconnect}>Retry</button>
      </span>
    {:else if connectionDown || dataStalled}
      <!-- A down socket, or one that is open but silent (a stop the per-tile staleness dashes
           never name; connectionLabel already says which). Not a live region: the always-mounted
           conn dot above announces every phase, and a second region carrying the same label
           announced the drop twice. This is the sighted half. -->
      <span
        class="readout fix-lost action-note action-note--wrap connection-action"
        title="Readouts pause until data returns"
      >
        {connectionLabel}
        <button type="button" class="btn btn-compact" onclick={onReconnect}>Reconnect</button>
      </span>
    {/if}
    {#if !online}
      <span class="readout offline" role="status" aria-live="polite">Offline</span>
    {/if}
    {#if fixStale}
      <span class="readout fix-lost" class:subordinate={linkDown} role="status" aria-live="polite"
        >No GPS fix</span
      >
    {:else if gpsNeverReceived}
      <!-- Connected, but no position has ever arrived: without this the strip looks healthy while
           every position-dependent feature silently waits. -->
      <span
        class="readout fix-lost action-note"
        role="status"
        aria-live="polite"
        title="Connected, but the server has not published a GPS position. Check the GPS source in the Signal K server's Data Browser, or open Help."
      >
        Waiting for GPS
        {#if onOpenHelp}
          <button type="button" class="btn btn-compact" onclick={onOpenHelp}>Help</button>
        {/if}
      </span>
    {/if}
    {#if orientation}
      <!-- The sound-off idiom: the chip states the live orientation (including its fallback), and
           the compact action is the one-tap return to north up. -->
      <span
        class="readout orientation-chip action-note"
        class:sev-warning={!orientation.active}
        role="status"
        title="Chart orientation and its reference; N up returns to north up"
      >
        {orientation.label}
        <button type="button" class="btn btn-compact" onclick={onResetOrientation}>N up</button>
      </span>
    {/if}
    {#if showLookout}
      <button
        type="button"
        class="readout lookout chip-btn"
        title={aisTitle}
        onclick={() => chipNote.show(aisTitle, CHIP_NOTE_MS)}
      >
        AIS <b class="num">{aisCount}</b>
        {#if aisUnassessed > 0}
          <span class="sev-warning">{aisUnassessed} unassessed</span>
        {/if}
      </button>
    {/if}
    {#if weatherWarning}
      <button
        type="button"
        class="readout chip-btn"
        title={`Weather warning: ${weatherWarning}. Open Weather for details.`}
        onclick={() =>
          chipNote.show(`Weather warning: ${weatherWarning}. Open Weather for details.`, CHIP_NOTE_MS)}
      >
        <span class="sev-warning">{weatherWarning}</span>
      </button>
    {/if}
    {#if anchor.watching}
      <!-- Named by its content, never a masking label: the alarm cue ("Anchor no GPS", distance
           over radius) must reach assistive tech; the open-panel action lives in the title. -->
      <button
        type="button"
        class="readout anchor-chip chip-btn"
        class:anchor-chip--alarm={anchor.dragging || anchor.fixLost}
        title={anchor.fixLost
          ? 'Anchor watch: no GPS fix, drag detection degraded. Opens Anchor watch.'
          : 'Anchor watch: distance from the anchor over the watch radius. Opens Anchor watch.'}
        onclick={onOpenAnchor}
      >
        {#if anchor.fixLost}
          Anchor <b>no GPS</b>
        {:else}
          Anchor <b class="num">{formatLengthOr(anchor.distanceMeters, units.mode, 0)}</b>/<b
            class="num"
            >{formatLengthOr(anchor.radiusMeters, units.mode, 0)}</b
          >
          {lengthUnit(units.mode)}
        {/if}
      </button>
    {/if}
    <span
      class="readout sog-readout"
      class:fix-lost={fixStale || vessel.sogStale}
      class:subordinate={linkDown}
      title="Speed over ground"
      >SOG
      <b class="num"
        >{formatSpeedOr(fixStale || vessel.sogStale ? undefined : vessel.sogMps, units.profile)}</b
      >
      {speedUnit(units.profile)}</span
    >
    {#if showCog}
      <span class="readout cog-readout" class:subordinate={linkDown} title="Course over ground"
        >COG
        <b class="num"
          >{formatBearingOr(
            fixStale || vessel.cogStale || (vessel.sogMps ?? 0) < COG_MIN_SOG_MPS
              ? undefined
              : vessel.cogRad,
          )}</b
        >&deg;T</span
      >
    {/if}
    {#if showHdg}
      <span
        class="readout hdg-readout"
        class:fix-lost={vessel.headingStale}
        class:subordinate={linkDown}
        title="Heading, true"
        >HDG
        <b class="num">{formatBearingOr(vessel.headingStale ? undefined : vessel.headingRad)}</b
        >&deg;T</span
      >
    {/if}
    <button
      type="button"
      class="readout depth-readout chip-btn"
      class:depth-alarm={shallowAlarming}
      class:fix-lost={depth.stale || shallowState !== 'monitoring'}
      class:subordinate={linkDown && !shallowAlarming}
      title={depthTitle(depth, shallowAlarming)}
      onclick={() => chipNote.show(depthTitle(depth, shallowAlarming), CHIP_NOTE_MS)}
    >
      {depthLabel}
      {#if !depthWatchPaused}
        <b class="num">{formatLengthOr(depth.stale ? undefined : depth.meters, units.mode)}</b>
        {lengthUnit(units.mode)}
        {#if depth.source}
          <span class="datum">{DEPTH_SOURCE_LABELS[depth.source]}</span>
        {/if}
      {/if}
    </button>
    {#if radarHealth.state !== 'quiet'}
      <!-- Radar trouble stays visible with Radar Controls closed: the picture the helm relies on
           has quietly stopped, which the panel alone cannot say. role=status announces once. -->
      <button
        type="button"
        class="readout chip-btn"
        class:sev-danger={radarHealth.state === 'failed'}
        class:sev-warning={radarHealth.state === 'stale'}
        title={radarTitle}
        onclick={() => chipNote.show(radarTitle, CHIP_NOTE_MS)}
      >
        <span role="status" aria-live="polite">
          {radarHealth.state === 'stale'
            ? 'Radar stale'
            : radarHealth.reason === 'renderer'
              ? 'Radar display failed'
              : 'Radar stream failed'}
        </span>
      </button>
    {/if}
  </div>
  <TransientNote message={chipNote.message} noteClass="chip-note" />
  <PinnedActions actions={pinnedActions} />
  <div class="center-cluster">
    {#if retainedFix}
      <!-- A stale fix never wears current-position styling: the label says what the coordinates
           are (the last fix and its age), in the same caution treatment as the dashed readouts. -->
      <span class="readout fix-lost" title="Last known position; the GPS fix is stale"
        >Last fix
        <b class="num">{formatLatitude(vessel.position?.latitude)}</b>
        <b class="num">{formatLongitude(vessel.position?.longitude)}</b>
        <span class="datum">{fixAgeText}</span></span
      >
    {:else}
      <span class="readout" title="Vessel position"
        >Vessel
        <b class="num">{formatLatitude(fixStale ? undefined : vessel.position?.latitude)}</b>
        <b class="num"
          >{formatLongitude(fixStale ? undefined : vessel.position?.longitude)}</b
        ></span
      >
    {/if}
    <span class="readout time-readout" title="Local time"
      >Time
      <b class="num">{formatClockTime(clock.now)}</b></span
    >
  </div>
</footer>

<style>
/* A three-column grid: the leading readouts, the pinned action pills centered in the flexible
   middle, and the trailing position cluster. The action area is real grid content, not an absolute
   overlay, so it can never paint over or steal taps from the readouts at any width. */
.status-strip {
  display: grid;
  /* The two flanking columns share the leftover space equally (1fr each) and the middle column
     sizes to the pinned pills' own content, so the pills sit at the true midpoint of the strip.
     auto 1fr auto (the middle column absorbing the leftover instead) centers the pills only
     within whatever space is left after the flanks, which drifts off-center by however much wider
     the readouts are than the trailing vessel position. */
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  padding-block-end: calc(var(--space-2) + var(--system-bar-clearance));
  padding-inline-start: calc(var(--space-4) + env(safe-area-inset-left, 0px));
  padding-inline-end: calc(var(--space-4) + env(safe-area-inset-right, 0px));
  /* Tall enough for a full control-size touch target, so it is not clipped at the bottom by the
     overflow-hidden viewport. */
  min-block-size: calc(var(--control-size) + var(--space-2));
  border-block-start: 1px solid var(--border);
  color: var(--text-muted);
  font-size: var(--text-md);
  /* The positioning context for the chip-tap note, which floats above the strip. */
  position: relative;
}
/* The bar's half of the two-part pin/unpin interaction (the app menu's tiles are the other half):
   a static accent edge, not animated, so the navigator sees this row is part of an active editing
   session without added motion at the helm. */
.status-strip.editing {
  border-block-start-color: var(--accent);
}
.strip-start {
  display: flex;
  /* Wrapping at every width, not only under 900px: the 1fr column shrinks below its content when
     degraded chips lengthen the row (No GPS fix, Depth stale, Reconnect), and an unwrappable row
     then paints under the centered pills, hiding safety text and burying the Reconnect tap
     target. A second readout line is always better than an occluded one. */
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  min-inline-size: 0;
}
/* The vessel position reads as one group at the trailing edge; the Position instrument tile
   covers the same value on demand, so this is the first thing dropped once space is tight.
   justify-content pins it to the far edge of its now-equal-share column (the true-centering grid
   above makes that column wider than its own content), matching where it sat before. Wraps for
   the same occlusion reason as the leading column, mirrored. */
.center-cluster {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  min-inline-size: 0;
}
/* Between a phone and a full desktop width, a landscape tablet keeps the three-column grid but
   cannot fit the readouts, every pinned pill, and both trailing readouts on one row. Time goes
   first (any watch or phone shows it; nothing else on the strip shows position), and the
   position readout follows only below 900, where the strip stacks anyway. */
@media (max-width: 1200px) {
  .center-cluster .time-readout {
    display: none;
  }
}
/* On a phone or small tablet the labeled pills and the live readouts do not fit one row, so the
   strip stacks into one centered column: the readouts above, and the labeled pills on a wrapping
   row below within thumb reach. The connection dot is small enough to stay. This block sits after
   the base rules above, so it wins the cascade when the query matches. */
@media (max-width: 900px) {
  .status-strip {
    grid-template-columns: 1fr;
    justify-items: center;
    gap: var(--space-2);
  }
  .strip-start {
    justify-content: center;
  }
  .center-cluster {
    display: none;
  }
}
@media (max-width: 600px) {
  .status-strip {
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    padding-block-end: calc(var(--space-1) + var(--system-bar-clearance));
    padding-inline-start: calc(var(--space-2) + env(safe-area-inset-left, 0px));
    padding-inline-end: calc(var(--space-2) + env(safe-area-inset-right, 0px));
  }
  .strip-start {
    gap: var(--space-2);
  }
}
.offline {
  color: var(--alarm);
}
/* A compact dot for the healthy state (the label stays for assistive tech and the hover title, so a
   healthy connection does not spend strip space on the word "Connected"); a mid-passage drop shows
   the dot's caution color plus the visible label and a Reconnect action right beside it, so a sighted
   user who has not hovered still sees why the strip has gone quiet, not just a color change. */
.conn {
  display: inline-flex;
  align-items: center;
}
/* The connection dot: a small dot whose color is the --dot-color token, healthy by default and the
   caution hue while the stream is reconnecting or closed. Scoped here, the only place it is used. */
.status-dot {
  inline-size: 0.6rem;
  block-size: 0.6rem;
  border-radius: 50%;
  background: var(--dot-color, var(--ok));
}
.conn--down .status-dot {
  --dot-color: var(--warning);
}
/* Interactive chips: a tap shows the chip's title explanation as a visible note (or opens the
   panel the chip monitors), with the UA button chrome stripped so a chip-button reads exactly
   like its span siblings. The block padding grows the touch target toward the compact-control
   size, and the negative block margin cancels it out of the strip's height. */
.chip-btn {
  border: 0;
  background: none;
  padding: var(--space-2) var(--space-1);
  margin-block: calc(-1 * var(--space-2));
  margin-inline: calc(-1 * var(--space-1));
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
}
.conn-live {
  display: inline-flex;
  align-items: center;
}
.connection-action {
  justify-content: center;
  max-inline-size: 100%;
  white-space: normal;
}
/* The chip-tap note floats above the strip, lifted over any safety rail by the shared clearance
   variable and layered below the safety strips so it can never cover a safety card. */
:global(.chip-note) {
  inset-block-end: calc(100% + var(--rail-clearance, 0px) + var(--space-1));
  z-index: calc(var(--z-safety-strips) - 1);
  max-inline-size: min(22rem, calc(100vw - 2 * var(--space-3)));
  font-size: var(--text-sm);
}
/* A lost own fix is a caution, not an alarm: the boat is still where it was, the position is just no
   longer updating. Warning-colored and calm, beside the dashed SOG and COG. */
.fix-lost {
  color: var(--warning);
  font-weight: 600;
}
/* The lookout chip is muted chrome: it confirms the AIS watch is live without competing with the
   hero SOG and COG. On a phone it drops with the rest of the secondary readouts. */
.lookout {
  color: var(--text-muted);
}
/* The anchor chip confirms the watch is live (distance over radius) as quiet chrome, and turns to
   the alarm color while the boat is dragging so the state reads even with the strip dismissed. */
.anchor-chip {
  color: var(--text-muted);
}
.anchor-chip--alarm {
  color: var(--alarm);
  font-weight: 600;
}
.anchor-chip--alarm b {
  color: var(--alarm);
}
/* The Depth readout is the only visible cue for why the shallow alarm is sounding: the tone alone
   does not say which alarm is beeping, so this pairs the sound with the same alarm color and
   weight the anchor drag chip uses. */
.depth-alarm {
  color: var(--alarm);
  font-weight: 600;
}
.depth-alarm b {
  color: var(--alarm);
}
/* The datum tag names which depth reference the number is (keel, surface, or transducer), so the
   strip and an instruments tile showing different depths on one screen explain themselves. It
   stays muted inside the alarm state: the label and value carry the alarm color. */
.datum {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
/* Keep each readout on one line, so "SOG -- kn" does not wrap to two lines when the strip is tight. */
.readout {
  white-space: nowrap;
}
/* One size for every readout value, so the whole strip reads as one quiet instrument row.
   --text-md matches the base strip font, so labels and values share a size too. */
.readout b {
  color: var(--text);
}
/* Subordinated consequence chips while the link itself is the failure remain readable. This sits
   after the warning and value rules so color, rather than opacity, preserves contrast for both the
   label and its bold numeric value. */
.readout.subordinate,
.readout.subordinate b {
  color: var(--text-subordinate);
}
</style>

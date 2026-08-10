<script lang="ts">
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
  formatBearingOr,
  formatClockTime,
  formatKnotsOr,
  formatLatitude,
  formatLengthOr,
  formatLongitude,
  lengthUnit,
  type ReactiveClock,
} from '$shared/lib';
import { type ConnectionPhase, isConnectionDown } from '$shared/signalk';

let {
  connectionLabel,
  streamError,
  dataStalled = false,
  online,
  fixStale,
  connectionPhase,
  aisCount,
  aisUnassessed = 0,
  anchor,
  units,
  vessel,
  shallowAlarming,
  shallowState = 'monitoring',
  radarHealth = { state: 'quiet' },
  audioState,
  onEnableSound,
  pinnedActions,
  editing = false,
  clock,
  onReconnect,
}: {
  connectionLabel: string;
  streamError: boolean;
  dataStalled?: boolean;
  online: boolean;
  fixStale: boolean;
  connectionPhase: ConnectionPhase;
  aisCount: number;
  // Retained targets the lookout cannot assess (course or motion missing), the persistent
  // degraded-assessment cue a watch handoff must be able to see at a glance.
  aisUnassessed?: number;
  anchor: AnchorWatch;
  units: UnitsStore;
  vessel: OwnVessel;
  shallowAlarming: boolean;
  // The shallow watch's honest state: any nonmonitoring grade names the pause instead of showing
  // a bare Depth placeholder.
  shallowState?: import('$features/lookout').ShallowMonitorState;
  // Helm-visible radar health: failure and staleness stay visible with Radar Controls closed.
  radarHealth?: import('$features/marine-radar').RadarHelmHealth;
  // 'ready' hides the chip; 'blocked' offers Enable (a gesture helps); 'failed' offers Retry; and
  // 'unsupported' states that audible alarms are unavailable on this display, with no dead action.
  audioState: import('$shared/audio').AlarmAudioState;
  onEnableSound: () => void;
  pinnedActions: MenuItem[];
  editing?: boolean;
  clock: ReactiveClock;
  onReconnect: () => void;
} = $props();

// COG is meaningless while the boat is stationary; under this speed the readout dashes.
const COG_MIN_SOG_MPS = 0.15;

const connectionDown = $derived(isConnectionDown(connectionPhase));

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
const depthLabel = $derived.by(() => {
  if (shallowAlarming) return 'Shallow';
  if (shallowState === 'stale' || depth.stale) return 'Depth stale, watch paused';
  if (shallowState === 'no-reading' || shallowState === 'no-source') {
    return 'Depth unavailable, watch paused';
  }
  return 'Depth';
});
</script>

<footer class="status-strip" class:editing>
  <div class="strip-start">
    <span
      class="conn"
      class:conn--down={connectionDown || dataStalled}
      role="status"
      aria-live="polite"
      title={connectionLabel}
    >
      <span class="status-dot" aria-hidden="true"></span>
      <span class="visually-hidden">{connectionLabel}</span>
    </span>
    {#if streamError}
      <span class="readout fix-lost" role="alert" aria-live="assertive">
        Data link failed
        <button type="button" class="btn btn-compact" onclick={onReconnect}>Retry</button>
      </span>
    {:else if connectionDown || dataStalled}
      <!-- A down socket, or one that is open but silent (a stop the per-tile staleness dashes
           never name; connectionLabel already says which). Not a live region: the always-mounted
           conn dot above announces every phase, and a second region carrying the same label
           announced the drop twice. This is the sighted half. -->
      <span class="readout fix-lost">
        {connectionLabel}
        <button type="button" class="btn btn-compact" onclick={onReconnect}>Reconnect</button>
      </span>
    {/if}
    {#if !online}
      <span class="readout offline" role="status" aria-live="polite">Offline</span>
    {/if}
    {#if fixStale}
      <span class="readout fix-lost" role="status" aria-live="polite">No GPS fix</span>
    {/if}
    {#if audioState === 'blocked'}
      <!-- role=status makes the chip's mount the polite announcement that alarm audio is off; the
           Enable tap is a user gesture, so it primes the shared context directly. -->
      <span class="readout sound-off" role="status" aria-live="polite">
        Sound off
        <button type="button" class="btn btn-compact" onclick={onEnableSound}>Enable</button>
      </span>
    {:else if audioState === 'failed'}
      <!-- Audio setup failed outright; a Retry re-attempts context construction, which can
           recover once the audio device returns. -->
      <span
        class="readout sound-off"
        role="status"
        aria-live="polite"
        title="Alarm audio failed to start; retry once the audio device is back"
      >
        Sound unavailable
        <button type="button" class="btn btn-compact" onclick={onEnableSound}>Retry</button>
      </span>
    {:else if audioState === 'unsupported'}
      <!-- No Web Audio API here at all: state the fact plainly, with no dead action. -->
      <span
        class="readout sound-off"
        role="status"
        aria-live="polite"
        title="Audible alarms are unavailable on this display; alerts remain visual only"
      >
        Sound unavailable
      </span>
    {/if}
    {#if connectionPhase === 'open'}
      <span
        class="readout lookout"
        title={aisUnassessed > 0
          ? `AIS targets the lookout is tracking; ${aisUnassessed} cannot be assessed for collision because course or motion data is missing or stale`
          : 'AIS targets the lookout is tracking'}
      >
        AIS <b class="num">{aisCount}</b>
        {#if aisUnassessed > 0}
          <span class="sev-warning">{aisUnassessed} unassessed</span>
        {/if}
      </span>
    {/if}
    {#if anchor.watching}
      <span
        class="readout anchor-chip"
        class:anchor-chip--alarm={anchor.dragging || anchor.fixLost}
        title={anchor.fixLost
          ? 'Anchor watch: no GPS fix, drag detection degraded'
          : 'Anchor watch: distance from the anchor over the watch radius'}
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
      </span>
    {/if}
    <span
      class="readout sog-readout"
      class:fix-lost={fixStale || vessel.sogStale}
      title="Speed over ground"
      >SOG
      <b class="num">{formatKnotsOr(fixStale || vessel.sogStale ? undefined : vessel.sogMps)}</b>
      kn</span
    >
    <span class="readout cog-readout" title="Course over ground"
      >COG
      <b class="num"
        >{formatBearingOr(
          fixStale || vessel.cogStale || (vessel.sogMps ?? 0) < COG_MIN_SOG_MPS
            ? undefined
            : vessel.cogRad,
        )}</b
      >&deg;T</span
    >
    <span class="readout hdg-readout" class:fix-lost={vessel.headingStale} title="Heading, true"
      >HDG
      <b class="num"
        >{formatBearingOr(vessel.headingStale ? undefined : vessel.headingRad)}</b
      >&deg;T</span
    >
    <span
      class="readout depth-readout"
      class:depth-alarm={shallowAlarming}
      class:fix-lost={depth.stale || shallowState !== 'monitoring'}
      title={depthTitle(depth, shallowAlarming)}
      >{depthLabel}
      <b class="num">{formatLengthOr(depth.stale ? undefined : depth.meters, units.mode)}</b>
      {lengthUnit(units.mode)}
      {#if depth.source}
        <span class="datum">{DEPTH_SOURCE_LABELS[depth.source]}</span>
      {/if}</span
    >
    {#if radarHealth.state !== 'quiet'}
      <!-- Radar trouble stays visible with Radar Controls closed: the picture the helm relies on
           has quietly stopped, which the panel alone cannot say. role=status announces once. -->
      <span
        class="readout"
        class:sev-danger={radarHealth.state === 'failed'}
        class:sev-warning={radarHealth.state === 'stale'}
        role="status"
        aria-live="polite"
        title={radarHealth.state === 'stale'
          ? 'Radar is transmitting but no fresh echo frames are arriving'
          : radarHealth.reason === 'renderer'
            ? 'Radar is transmitting but the echo display failed on this device; open Radar controls'
            : 'Radar is transmitting but its data stream failed; open Radar controls'}
      >
        {radarHealth.state === 'stale'
          ? 'Radar stale'
          : radarHealth.reason === 'renderer'
            ? 'Radar display failed'
            : 'Radar stream failed'}
      </span>
    {/if}
  </div>
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
    <span class="readout" title="Local time"
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
}
/* The bar's half of the two-part pin/unpin interaction (the app menu's tiles are the other half):
   a static accent edge, not animated, so the navigator sees this row is part of an active editing
   session without added motion at the helm. */
.status-strip.editing {
  border-block-start-color: var(--accent);
}
.strip-start {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-inline-size: 0;
}
/* The vessel position reads as one group at the trailing edge; the Position instrument tile
   covers the same value on demand, so this is the first thing dropped once space is tight.
   justify-content pins it to the far edge of its now-equal-share column (the true-centering grid
   above makes that column wider than its own content), matching where it sat before. */
.center-cluster {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  min-inline-size: 0;
}
/* Between a phone and a full desktop width, a landscape tablet is wide enough to keep the
   three-column grid but too narrow to fit the flanking readouts and every pinned action pill on
   one row; the pill row is flex-wrap and has no floor, so it is what breaks, dropping one pill
   onto its own ragged second row. Freeing the trailing position cluster's column here, before
   that wrap point, keeps the pinned actions on one row across the whole tablet range instead of
   tuning to one device width. */
@media (max-width: 1200px) {
  .center-cluster {
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
    flex-wrap: wrap;
    justify-content: center;
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
  .cog-readout,
  .hdg-readout,
  .lookout {
    display: none;
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
/* A lost own fix is a caution, not an alarm: the boat is still where it was, the position is just no
   longer updating. Warning-colored and calm, beside the dashed SOG and COG. */
.fix-lost {
  color: var(--warning);
  font-weight: 600;
}
/* Alarm audio is blocked (no priming gesture since load): alarm-colored, because an armed watch
   is silently visual-only until the operator taps. */
.sound-off {
  color: var(--alarm);
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
</style>

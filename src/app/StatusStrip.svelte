<script lang="ts">
import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
import { onDestroy, onMount, type Snippet } from 'svelte';
import type { AnchorWatch } from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import {
  DEPTH_SOURCE_LABELS,
  DEPTH_SOURCE_TITLES,
  type DepthReading,
  type OwnVessel,
} from '$entities/vessel';
import { AutopilotChip } from '$features/autopilot';
import { MAX_BAR_PILLS, MAX_COMPACT_BAR_PILLS, type MenuItem, PinnedActions } from '$features/menu';
import type { CompanionState } from '$features/prewarm';
import { type AlarmAudioState, primeAlarmAudio } from '$shared/audio';
import {
  createMediaQuery,
  formatBearingOr,
  formatClockTime,
  formatLatitude,
  formatLengthOr,
  formatLongitude,
  formatMetersOrNm,
  formatSpeedOr,
  LANDSCAPE_SHORT_QUERY,
  lengthUnit,
  NARROW_QUERY,
  type ReactiveClock,
  speedUnit,
  Toast,
} from '$shared/lib';
import { COG_MIN_SOG_MPS } from '$shared/nav';
import { type ConnectionPhase, isConnectionDown } from '$shared/signalk';
import { observeClientHeight, TransientNote } from '$shared/ui';
import { readoutBudget } from './readout-budget';
import StatusCell from './StatusCell.svelte';
import { buildStatusNotices } from './status-notices';

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
  collisionMuteMinutes = undefined,
  onUnmuteCollision = undefined,
  updateReady = false,
  onReload = undefined,
  chartLocker = undefined,
  onRetryChartLocker = undefined,
  onOpenOfflineCharts = undefined,
  onOpenWeather = undefined,
  onOpenRadar = undefined,
  onOpenAis = undefined,
  emergency = false,
  start = undefined,
  end = undefined,
  onBarHeight = () => {},
}: {
  connectionLabel: string;
  // The fuller diagnosis behind the short connection label, shown on the Status cell's hover and in
  // its list.
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
  // reference driving it, and the full label naming any fallback to north. One tap on a rotating
  // cell returns to north up; while the rotation has fallen back, the cell explains and the caution
  // line carries Use north up. Absent in the default north-up mode, where an unrotated chart speaks
  // for itself.
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
  // The collision alarm's mute, in whole minutes left; undefined while it sounds normally.
  collisionMuteMinutes?: number;
  onUnmuteCollision?: () => void;
  // A new version of the app is waiting for a reload.
  updateReady?: boolean;
  onReload?: () => void;
  // Chart Locker's access state, while it is installed.
  chartLocker?: { state: CompanionState; accessUrl: string };
  onRetryChartLocker?: () => void;
  onOpenOfflineCharts?: () => void;
  onOpenWeather?: () => void;
  onOpenRadar?: () => void;
  onOpenAis?: () => void;
  // A safety alarm is taking the screen, so nothing the bar opened may cover its card.
  emergency?: boolean;
  // The bar's two ends: the menu at the start and MOB at the end. Each receives whether the bar is
  // slim, where only icons fit.
  start?: Snippet<[boolean]>;
  end?: Snippet<[boolean]>;
  // The bar's full height, for surfaces that open above it and must not cover it.
  onBarHeight?: (height: number) => void;
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

// Enable and Try again prime audio themselves rather than leaning on App's first-gesture listeners,
// which remove themselves once audio first runs: a context the browser suspends later (a
// backgrounded tab, a phone call) would otherwise leave an Enable tap that does nothing. A blocked
// gate clears on the tap and the notice leaves; a failed device may not come back, so that tap also
// says why, on the row the list already shows. Unsupported has no action at all, only the
// explanation.
// A fallen-back rotation is already showing north up and resumes on its own when its data returns,
// so a tap on its caution-styled cell explains, like every other caution cell, rather than
// discarding the chosen mode; choosing north up for good is the Status list's explicit action.
function explainOrientation(): void {
  if (orientation) chipNote.show(`${orientation.label}. ${ORIENTATION_RESUMES}`, CHIP_NOTE_MS);
}
const ORIENTATION_RESUMES = 'The chosen rotation resumes when its data returns.';
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

// The bar's layout, measured: whether the ends go slim (icons only), whether the bar is a sideways
// phone's single row, and how many columns the readouts have, which decides what gives way.
const landscapeShort = createMediaQuery(LANDSCAPE_SHORT_QUERY);
// The ends go slim while the bar holds fewer than two end columns and four readout columns, counted
// in the bar's own column module, so it follows the text size. A phone held sideways always goes
// slim, since its height is the scarce axis.
const SLIM_BAR_COLUMNS = 6;
// A sideways phone keeps one row while three readout columns fit beside the tiles.
const SIDEWAYS_ROW_REM = 34;
let footer = $state<HTMLElement>();
let grid = $state<HTMLElement>();
let readouts = $state<HTMLElement>();
let barRem = $state(Number.POSITIVE_INFINITY);
let cellRem = $state(0);
let readoutColumns = $state(Number.POSITIVE_INFINITY);
const slim = $derived(landscapeShort.matches || barRem < SLIM_BAR_COLUMNS * cellRem);
const sideways = $derived(landscapeShort.matches && barRem >= SIDEWAYS_ROW_REM);

function measure(): void {
  if (!footer || !grid || !readouts) return;
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // The content box, as the container queries see it.
  const style = getComputedStyle(footer);
  const content =
    footer.clientWidth -
    Number.parseFloat(style.paddingInlineStart) -
    Number.parseFloat(style.paddingInlineEnd);
  barRem = content / root;
  cellRem = Number.parseFloat(style.getPropertyValue('--strip-cell-min')) || 0;
  // The helm row places every readout in a reserved column, so nothing gives way there.
  if (getComputedStyle(readouts).display === 'contents') {
    readoutColumns = Number.POSITIVE_INFINITY;
    return;
  }
  // A subgrid reports no tracks of its own: count the bar's columns between the two ends.
  const own = getComputedStyle(readouts).gridTemplateColumns;
  const tracks = (own.startsWith('subgrid') ? getComputedStyle(grid).gridTemplateColumns : own)
    .split(' ')
    .filter((track) => Number.parseFloat(track) > 0).length;
  readoutColumns = own.startsWith('subgrid') ? Math.max(0, tracks - 2) : tracks;
}

onMount(() => {
  let frame: number | undefined;
  const schedule = (): void => {
    if (frame === undefined)
      frame = requestAnimationFrame(() => {
        frame = undefined;
        measure();
      });
  };
  const observer = new ResizeObserver(schedule);
  if (footer) observer.observe(footer);
  observer.observe(document.documentElement);
  measure();
  return () => {
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
});

// The optional readouts own fixed spare columns on the helm row, so one appearing never moves
// another: chart orientation (a standing setting) the first, the anchor watch the second, and the
// autopilot the second unless the anchor holds it, when it takes the Time column and Time steps
// aside. Stacked layouts place them in reading order.
const showAutopilot = $derived(
  autopilotChip !== undefined && autopilotChip.kind !== 'hidden' && onOpenAutopilot !== undefined,
);
const autopilotSlot = $derived(anchor.watching ? 'slot-extra-3' : 'slot-extra-2');
const extras = $derived(
  (orientation ? 1 : 0) + (anchor.watching ? 1 : 0) + (showAutopilot ? 1 : 0),
);
const budget = $derived(readoutBudget(readoutColumns, extras));

// A narrow bar carries a bounded, context-prioritized readout set instead of hiding COG, heading,
// and AIS with fixed CSS: underway or navigating, COG is the course reference, and a boat with only
// a compass shows HDG. Unassessed AIS targets are always the Status cell's to report, so a compact
// bar dropping the AIS cell never hides them. Wide layouts show everything.
const compactQuery = createMediaQuery(NARROW_QUERY);
const compact = $derived(compactQuery.matches || budget.compact);
const underway = $derived(!vessel.sogStale && (vessel.sogMps ?? 0) >= COG_MIN_SOG_MPS);
const showCog = $derived(!compact || navigating || underway);
const showHdg = $derived(
  !compact || (!showCog && !vessel.headingStale && vessel.headingRad !== undefined),
);
const lookoutOpen = $derived(connectionPhase === 'open');
const showLookout = $derived(lookoutOpen && !compact);

// The pinned tiles take whole bar columns, centered between the ends as closely as whole columns
// allow (an odd leftover leans toward the start), while the bar has a column
// for each; otherwise they share the readouts' width as equal tiles. The span is what the bar
// draws: every pin up to the bar's cap (the cap counts the More tile when there are more).
const tileSpan = $derived(
  Math.min(pinnedActions.length, compactQuery.matches ? MAX_COMPACT_BAR_PILLS : MAX_BAR_PILLS),
);
const tilesOnColumns = $derived(
  !sideways && Number.isFinite(readoutColumns) && tileSpan > 0 && readoutColumns >= tileSpan,
);
const tileStart = $derived(2 + Math.floor((readoutColumns - tileSpan) / 2));

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

// One string, so the label and its reference cannot be split by a reflow into two spaces.
const orientationLabel = $derived(
  orientation?.reference ? `Chart · ${orientation.reference}` : 'Chart',
);

const notices = $derived(
  buildStatusNotices({
    streamError,
    connecting: connectionPhase === 'connecting',
    connectionDown,
    dataStalled,
    connectionLabel,
    connectionTitle: connTitle,
    online,
    fixStale,
    gpsNeverReceived,
    linkDown,
    depthPaused: depthWatchPaused,
    depthTitle: depthTitle(depth, shallowAlarming),
    collisionMuteMinutes,
    soundOff,
    alertCount,
    weatherWarning,
    radarHealth,
    lookoutOpen,
    aisUnassessed,
    aisTitle,
    orientation,
    chartLocker,
    updateReady,
    onReconnect,
    onOpenHelp,
    onUnmuteCollision,
    onEnableSound: primeAlarmAudio,
    onRetrySound: primeAlarmAudio,
    onOpenAlarms,
    onOpenWeather,
    onOpenRadar,
    onOpenAis,
    onResetOrientation,
    onRetryChartLocker,
    onOpenOfflineCharts,
    onReload,
  }),
);
</script>

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

<!-- Live chrome: menus opened anywhere leave it uncovered and close on a tap here (AnchoredMenu). -->
<footer
  class="status-strip"
  data-live-chrome
  class:editing
  bind:this={footer}
  use:observeClientHeight={() => onBarHeight(footer?.offsetHeight ?? 0)}
>
  <!-- Source order is the focus order: the menu, then MOB, then the readouts, so the emergency key
       is the second stop however wide the bar is. The grid sets MOB at the trailing end. -->
  <div
    class="strip-grid"
    class:slim
    class:sideways
    class:tiles-on-columns={tilesOnColumns}
    style:--tile-start={tilesOnColumns ? tileStart : undefined}
    style:--tile-span={tilesOnColumns ? tileSpan : undefined}
    bind:this={grid}
  >
    <div class="bookend bookend--start" data-menu-opener-group>{@render start?.(slim)}</div>
    <div class="bookend bookend--end">{@render end?.(slim)}</div>
    <div class="strip-readouts" bind:this={readouts}>
      <StatusCell {notices} {connectionLabel} connectionTitle={connTitle} {emergency} />
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
        <!-- A rotating cell is its own action: one tap returns the chart to north up. A fallen-back
             cell explains instead. The full label, reason included, is a live region, so a
             fallback is announced with its cause as well as drawn. -->
        <button
          type="button"
          class="data-cell orientation-readout slot-extra-1"
          class:data-cell--warning={!orientation.active}
          title={orientation.active
            ? `Chart orientation: ${orientation.label}. Tap to return to north up.`
            : `Chart orientation: ${orientation.label}. ${ORIENTATION_RESUMES}`}
          onclick={orientation.active ? onResetOrientation : explainOrientation}
        >
          <span class="data-cell-label">
            {#if !orientation.active}
              <TriangleAlert size={12} aria-hidden="true" />
            {/if}
            {orientationLabel}
          </span>
          <span class="data-cell-value">
            <span class="word" aria-hidden="true">{orientation.shown}</span>
            <span class="visually-hidden" role="status" aria-live="polite"
              >{orientation.label}</span
            >
            {#if orientation.active}
              <span class="visually-hidden">, return to north up</span>
            {/if}
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
              <!-- The radius is the qualifier, so on a tight column it ellipsizes before the
                   distance or its unit is cut. -->
              <b class="num">{formatLengthOr(anchor.distanceMeters, units.mode, 0)}</b>
              <span>{lengthUnit(units.mode)}</span>
              <span class="data-cell-qualifier"
                >of {formatLengthOr(anchor.radiusMeters, units.mode, 0)}</span
              >
            {/if}
          </span>
        </button>
      {/if}
      {#if showAutopilot && autopilotChip && onOpenAutopilot}
        <AutopilotChip chip={autopilotChip} onOpen={onOpenAutopilot} cellClass={autopilotSlot} />
      {/if}
      {#if budget.position}
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
      {/if}
      {#if budget.time}
        <span class="data-cell time-readout slot-time" title="Local time">
          <span class="data-cell-label">Time</span>
          <span class="data-cell-value"><b class="num">{formatClockTime(clock.now)}</b></span>
        </span>
      {/if}
    </div>
    <PinnedActions actions={pinnedActions} {emergency} />
  </div>
  <TransientNote message={chipNote.message} noteClass="chip-note" />
</footer>

<style>
/* The status bar is the app's only chrome: one grid of equal columns, the bar's design rule. The menu
   and MOB bookend it at full height, every readout is one column (the vessel position two), every
   pinned tile is one column, labels share one line and values share one baseline across the bar
   (the .data-cell vocabulary in data-cells.css), and a problem never adds a row: it shows in its own
   readout or in the Status cell. Four layouts, one rule:
   - Stacked, the default: the ends take the first and last column, the readouts flow through the
     columns between them (a subgrid, so every cell edge is a bar column edge), and the tiles sit on
     whole columns centered beneath.
   - Slim, a narrow bar: the ends shrink to one icon target each and the readouts share the rest.
   - Sideways phone: the readouts beside icon tiles on one row, between slim ends.
   - Helm row, once the bar holds seventeen columns: everything on one row, in reserved columns.
   Focus follows the source order (menu, MOB, readouts, tiles) everywhere. */
.status-strip {
  /* The query container for the helm row and the large-text layout below. */
  container: status-strip / inline-size;
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
  grid-template-columns: repeat(auto-fill, minmax(var(--strip-cell-min), 1fr));
  grid-template-rows: auto auto;
  row-gap: var(--space-1);
}
.bookend {
  display: grid;
  grid-row: 1 / -1;
  min-inline-size: 0;
}
.bookend--start {
  position: relative;
  grid-column: 1;
  padding-inline-end: var(--space-1);
}
.bookend--end {
  grid-column: -2 / -1;
  padding-inline-start: var(--space-1);
}
.strip-readouts {
  grid-column: 2 / -2;
  grid-row: 1;
  display: grid;
  grid-template-columns: subgrid;
}
.strip-grid > :global(.pinned-actions) {
  grid-column: 2 / -2;
  grid-row: 2;
}
/* The tiles on whole bar columns, one each, centered between the ends; fewer tiles than columns
   start at the first, so every tile edge stays on the grid. */
.strip-grid.tiles-on-columns > :global(.pinned-actions) {
  grid-column: var(--tile-start) / span var(--tile-span);
  --bar-capacity: var(--tile-span);
  --bar-tile-column: calc(100% / var(--tile-span));
  --bar-tile-gap: 0;
  --bar-tile-inset: var(--space-1);
  --bar-tile-justify: start;
}
.strip-grid.slim {
  grid-template-columns:
    calc(var(--target-floor) + var(--space-1))
    repeat(auto-fill, minmax(var(--strip-cell-min), 1fr))
    calc(var(--target-floor) + var(--space-1));
}
/* A phone held sideways has the width for one row but not the height for two: the readouts take the
   middle on their own equal-column grid (wrapping whole cells onto a second line of the same columns
   rather than running under the tiles), with the icon tiles beside them, all between slim ends. */
.strip-grid.sideways {
  grid-template-columns:
    calc(var(--target-floor) + var(--space-1))
    minmax(0, 1fr)
    auto
    calc(var(--target-floor) + var(--space-1));
  grid-template-rows: auto;
}
.strip-grid.sideways .strip-readouts {
  grid-column: 2;
  grid-template-columns: repeat(auto-fill, minmax(var(--strip-cell-min), 1fr));
}
.strip-grid.sideways > :global(.pinned-actions) {
  grid-column: 3;
  grid-row: 1;
  align-self: start;
  padding-inline-start: var(--space-1);
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
/* On a phone or small tablet the position and time readouts leave the strip at once, before the
   measured budget runs: any watch or phone shows the time, and the Position instrument tile covers
   the position on demand. With no two-column position to hold, the columns may narrow to one
   single-value readout. */
@media (max-width: 900px) {
  .status-strip {
    --strip-cell-min: 5.75rem;
  }
  .slot-position,
  .slot-time {
    display: none;
  }
}
@media (orientation: landscape) and (max-height: 500px) and (max-width: 1000px) {
  .slot-position,
  .slot-time {
    display: none;
  }
}
/* Very large text on a narrow phone, where not even two readout columns fit between the ends: a
   column of one readout per row would stack the strip taller than the chart can spare and push a
   safety strip off the screen. The cells set their label beside the value instead, at the physical
   44 px target floor, and wrap as whole items. Two narrow columns and the two slim ends (a 44 px
   target and its 4 px gap each; a query cannot read a custom property), so it only ever applies
   at enlarged text. */
@container status-strip (max-width: calc(11.5rem + 96px)) {
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
/* The helm row: seventeen equal columns, about 1,880 px of bar at the default text size. The menu,
   the Status cell, five instrument columns, four tile columns, two spare columns for the optional
   readouts, two for the position, one for the time, and MOB. Seventeen --data-cell-min columns (the
   container is the bar's content box); change the two together. */
@container status-strip (min-width: 117.3rem) {
  .strip-grid {
    grid-template-columns: repeat(17, minmax(0, 1fr));
    grid-template-rows: auto;
    reading-flow: grid-rows;
  }
  /* The visual order runs the readouts left to right; the two ends keep their early focus stops. */
  .bookend {
    grid-row: 1;
  }
  .bookend--start {
    reading-order: -2;
  }
  .bookend--end {
    reading-order: -1;
  }
  .strip-readouts {
    display: contents;
  }
  .strip-readouts > :global(*) {
    grid-row: 1;
  }
  .strip-readouts > :global(.slot-status) {
    grid-column: 2;
  }
  .slot-ais {
    grid-column: 3;
  }
  .slot-sog {
    grid-column: 4;
  }
  .slot-cog {
    grid-column: 5;
  }
  .slot-hdg {
    grid-column: 6;
  }
  .slot-depth {
    grid-column: 7;
  }
  .strip-grid > :global(.pinned-actions),
  .strip-grid.tiles-on-columns > :global(.pinned-actions) {
    grid-column: 8 / span 4;
    grid-row: 1;
    --bar-capacity: 4;
    --bar-tile-column: 25%;
    --bar-tile-gap: 0;
    --bar-tile-inset: var(--space-1);
    /* Fewer than four tiles start at the first tile column, so every tile edge stays on the grid. */
    --bar-tile-justify: start;
    /* On a row shared with the readouts, a tile's label sits on their value baseline. */
    --bar-tile-rows: var(--data-label-line) var(--data-value-line);
    --bar-tile-row-gap: 0;
    --bar-tile-label-line: var(--data-value-line);
    --bar-tile-strut: inline;
  }
  .slot-extra-1 {
    grid-column: 12;
  }
  .strip-readouts > :global(.slot-extra-2) {
    grid-column: 13;
  }
  .slot-position {
    grid-column: 14 / span 2;
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
    grid-column: 16;
  }
  .strip-readouts:has(:global(.slot-extra-3)) .slot-time {
    display: none;
  }
}
</style>

<script lang="ts">
import { Ellipsis } from '@lucide/svelte';
import { onDestroy } from 'svelte';
import type { AnchorWatch } from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import {
  blockedReason,
  itemBlocked,
  MAX_BAR_PILLS,
  type MenuItem,
  MenuItemIcon,
  splitBarActions,
} from '$features/menu';
import {
  formatBearingOr,
  formatClockTime,
  formatKnotsOr,
  formatLatitude,
  formatLengthOr,
  formatLongitude,
  lengthUnit,
  type ReactiveClock,
  Toast,
} from '$shared/lib';
import type { ConnectionPhase } from '$shared/signalk';
import { AnchoredMenu, UnavailableHint } from '$shared/ui';

let {
  connectionLabel,
  streamError,
  online,
  fixStale,
  connectionPhase,
  aisCount,
  anchor,
  units,
  vessel,
  pinnedActions,
  editing = false,
  clock,
  onReconnect,
}: {
  connectionLabel: string;
  streamError: boolean;
  online: boolean;
  fixStale: boolean;
  connectionPhase: ConnectionPhase;
  aisCount: number;
  anchor: AnchorWatch;
  units: UnitsStore;
  vessel: OwnVessel;
  pinnedActions: MenuItem[];
  editing?: boolean;
  clock: ReactiveClock;
  onReconnect: () => void;
} = $props();

// COG is meaningless while the boat is stationary; under this speed the readout dashes.
const COG_MIN_SOG_MPS = 0.15;

const connectionDown = $derived(connectionPhase === 'reconnecting' || connectionPhase === 'closed');
const split = $derived(splitBarActions(pinnedActions, MAX_BAR_PILLS));
const moreActive = $derived(split.overflow.some((a) => a.pressed === true));
let moreOpen = $state(false);
const closeMore = (): void => {
  moreOpen = false;
};

// A blocked pill's reason is otherwise only reachable via its hover-only title tooltip, which
// never fires on a tap; this explains itself the same way the app menu's blocked tiles do.
const PILL_NOTE_MS = 5000;
const blockedPillNote = new Toast();
onDestroy(() => blockedPillNote.dispose());

// Shared by both the visible pills and the overflow rows: `after` runs once the action fires, so
// only the overflow row needs to close the popover afterward.
function runPillAction(action: MenuItem, after?: () => void): void {
  if (itemBlocked(action)) {
    blockedPillNote.show(blockedReason(action) ?? action.label, PILL_NOTE_MS);
    return;
  }
  try {
    action.onSelect();
  } finally {
    after?.();
  }
}
</script>

<footer class="status-strip" class:editing>
  <div class="strip-start">
    <span
      class="conn"
      class:conn--down={connectionDown}
      role="status"
      aria-live="polite"
      title={connectionLabel}
    >
      <span class="status-dot" aria-hidden="true"></span>
      <span class="visually-hidden">{connectionLabel}</span>
    </span>
    {#if streamError}
      <span class="readout fix-lost" role="alert" aria-live="assertive">
        Data link failed, reload
      </span>
    {:else if connectionDown}
      <span class="readout fix-lost" role="status" aria-live="polite">
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
    {#if connectionPhase === 'open'}
      <span class="readout lookout" title="AIS targets the lookout is tracking">
        AIS <b class="num">{aisCount}</b>
      </span>
    {/if}
    {#if anchor.watching}
      <span
        class="readout anchor-chip"
        class:anchor-chip--alarm={anchor.dragging || anchor.fixLost}
        role="status"
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
    <span class="readout" title="Speed over ground"
      >SOG <b class="num">{formatKnotsOr(fixStale ? undefined : vessel.sogMps)}</b> kn</span
    >
    <span class="readout" title="Course over ground"
      >COG
      <b class="num"
        >{formatBearingOr(
          fixStale || (vessel.sogMps ?? 0) < COG_MIN_SOG_MPS ? undefined : vessel.cogRad,
        )}</b
      >&deg;T</span
    >
    <span class="readout" title="Heading, true"
      >HDG
      <b class="num">{formatBearingOr(vessel.headingRad)}</b>&deg;T</span
    >
    <span class="readout" title="Depth below the transducer"
      >Depth
      <b class="num">{formatLengthOr(vessel.depthMeters, units.mode)}</b>
      {lengthUnit(units.mode)}</span
    >
    <span class="readout" title="UTC time, for watch changes and weather schedules"
      >{formatClockTime(clock.now, { utc: true })}
      UTC</span
    >
  </div>
  <div class="strip-center">
    <!-- Reserved via absolute positioning above the pill row, so it never shifts the strip's
         height under a mid-tap thumb; hidden until a blocked pill is tapped. -->
    {#if blockedPillNote.message}
      <p class="blocked-pill-note popover-card" role="status" aria-live="polite">
        {blockedPillNote.message}
      </p>
    {/if}
    {#each split.visible as action (action.id)}
      <button
        type="button"
        class="btn btn-pill"
        class:is-on={action.pressed === true}
        aria-pressed={action.pressed === undefined ? undefined : action.pressed}
        disabled={action.disabled === true}
        aria-disabled={action.available === false ? true : undefined}
        title={blockedReason(action) ?? action.label}
        onclick={() => runPillAction(action)}
      >
        <UnavailableHint hint={action.available === false ? action.unavailableHint : undefined} />
        <MenuItemIcon item={action} size={16} />
        {action.shortLabel ?? action.label}
      </button>
    {/each}
    {#if split.overflow.length > 0}
      <div class="more-wrap">
        <button
          type="button"
          class="btn btn-pill"
          class:is-on={moreActive || moreOpen}
          aria-haspopup="true"
          aria-expanded={moreOpen}
          aria-controls={moreOpen ? 'bar-more-menu' : undefined}
          aria-label={`More actions (${split.overflow.length})`}
          title="More actions"
          onclick={() => (moreOpen = !moreOpen)}
        >
          <Ellipsis size={16} aria-hidden="true" />
          More
          {#if split.overflow.length > 1}
            <span class="pill-count" aria-hidden="true">{split.overflow.length}</span>
          {/if}
        </button>
        <AnchoredMenu
          open={moreOpen}
          onClose={closeMore}
          backdropLabel="Close more actions"
          surfaceClass="popover-card bar-more"
          ariaLabel="More actions"
          id="bar-more-menu"
        >
          {#snippet children()}
            {#each split.overflow as action (action.id)}
              <button
                type="button"
                class="menu-item"
                class:is-on={action.pressed === true}
                aria-pressed={action.pressed === undefined ? undefined : action.pressed}
                disabled={action.disabled === true}
                aria-disabled={action.available === false ? true : undefined}
                title={blockedReason(action) ?? action.label}
                onclick={() => runPillAction(action, closeMore)}
              >
                <UnavailableHint
                  hint={action.available === false ? action.unavailableHint : undefined}
                />
                <MenuItemIcon item={action} size={16} />
                {action.label}
              </button>
            {/each}
          {/snippet}
        </AnchoredMenu>
      </div>
    {/if}
  </div>
  <div class="center-cluster">
    <span class="readout" title="Vessel position">Vessel</span>
    <span class="readout"><b class="num">{formatLatitude(vessel.position?.latitude)}</b></span>
    <span class="readout"><b class="num">{formatLongitude(vessel.position?.longitude)}</b></span>
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
/* The pinned action pills read as one row of matching labeled pills in the flexible middle.
   They wrap rather than overflow when a narrow phone leaves too little width. Positioned, so the
   blocked-pill note can anchor above it. */
.strip-center {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
}
/* A pinned action whose provider is absent grays out but stays focusable and hoverable
   (aria-disabled, not the disabled attribute) so its tooltip shows and a screen reader reaches the
   reason, matching the menu tiles and the layer rows. The click is guarded in script. The hover
   resets undo the shared .btn and .menu-item hover affordance so a grayed control does not light up. */
.btn-pill[aria-disabled="true"],
.menu-item[aria-disabled="true"] {
  opacity: var(--disabled-opacity);
  cursor: default;
}
.btn-pill[aria-disabled="true"]:hover {
  border-color: var(--border);
  background: var(--surface-raised);
}
.menu-item[aria-disabled="true"]:hover {
  background: transparent;
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
.more-wrap {
  position: relative;
}
/* Sets expectations for how many actions are behind the overflow tap, rather than an unqualified
   "More"; only shown past a single overflow action, where the count is actually informative. */
.pill-count {
  font-size: var(--text-xs);
  background: var(--accent-tint);
  border-radius: var(--radius-pill);
  padding: 0 0.3rem;
  color: var(--accent);
}
/* Floats above the pinned pill row so a tap on a grayed pill explains itself, mirroring the app
   menu's own blocked-note pattern; the frame comes from the shared .popover-card composition. */
.blocked-pill-note {
  position: absolute;
  inset-block-end: calc(100% + var(--space-1));
  inset-inline-start: 50%;
  transform: translateX(-50%);
  z-index: var(--z-menu);
  max-inline-size: 16rem;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  text-align: center;
}
/* Positions and lays out the More popover; the frame (border, surface, radius, and shadow) comes
   from the shared .popover-card it is composed with, so it cannot drift from the other menus. */
:global(.bar-more) {
  position: absolute;
  inset-block-end: calc(100% + var(--space-1));
  inset-inline-end: 0;
  transform-origin: bottom right;
  z-index: var(--z-menu);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-inline-size: 12rem;
  padding: var(--space-1);
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

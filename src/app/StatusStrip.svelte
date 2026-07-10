<script lang="ts">
import { Ellipsis } from '@lucide/svelte';
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
  formatFixed,
  formatKnotsOr,
  formatLatitude,
  formatLengthOr,
  formatLongitude,
  lengthUnit,
  type ReactiveClock,
} from '$shared/lib';
import type { MapView } from '$shared/settings';
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
  mapView,
  pinnedActions,
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
  mapView: MapView | undefined;
  pinnedActions: MenuItem[];
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
</script>

<footer class="status-strip">
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
    {#each split.visible as action (action.id)}
      <button
        type="button"
        class="btn btn-pill"
        class:is-on={action.pressed === true}
        aria-pressed={action.pressed === undefined ? undefined : action.pressed}
        disabled={action.disabled === true}
        aria-disabled={action.available === false ? true : undefined}
        title={blockedReason(action) ?? action.label}
        onclick={() => {
          if (!itemBlocked(action)) action.onSelect();
        }}
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
          aria-label="More actions"
          title="More actions"
          onclick={() => (moreOpen = !moreOpen)}
        >
          <Ellipsis size={16} aria-hidden="true" />
          More
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
                onclick={() => {
                  if (itemBlocked(action)) return;
                  try {
                    action.onSelect();
                  } finally {
                    closeMore();
                  }
                }}
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
    <span
      class="readout"
      title="Vessel position, which differs from the view below when the chart is panned"
      >Vessel</span
    >
    <span class="readout"><b class="num">{formatLatitude(vessel.position?.latitude)}</b></span>
    <span class="readout"><b class="num">{formatLongitude(vessel.position?.longitude)}</b></span>
    <span class="readout">View</span>
    <span class="readout"><b class="num">{formatLatitude(mapView?.lat)}</b></span>
    <span class="readout"><b class="num">{formatLongitude(mapView?.lon)}</b></span>
    <span class="readout">z<b class="num">{formatFixed(mapView?.zoom, 1)}</b></span>
  </div>
</footer>

<style>
/* A three-column grid: the leading readouts, the pinned action pills centered in the flexible
   middle, and the trailing position cluster. The action area is real grid content, not an absolute
   overlay, so it can never paint over or steal taps from the readouts at any width. */
.status-strip {
  display: grid;
  grid-template-columns: auto 1fr auto;
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
.strip-start {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-inline-size: 0;
}
/* The pinned action pills read as one row of matching labeled pills in the flexible middle.
   They wrap rather than overflow when a narrow phone leaves too little width. */
.strip-center {
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
/* The center lat, lon, and zoom readout reads as one group at the trailing edge, and is the first
   thing dropped on a phone, where the chart and the panels still report position. */
.center-cluster {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-inline-size: 0;
}
/* On a phone or small tablet the labeled pills and the live readouts do not fit one row, so the
   strip stacks into one centered column: the readouts above, and the labeled pills on a wrapping
   row below within thumb reach. The duplicate position cluster drops (the chart and panels still
   report it); the connection dot is small enough to stay. This block sits after the base rules
   above, so it wins the cascade when the query matches. */
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
  .center-cluster {
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

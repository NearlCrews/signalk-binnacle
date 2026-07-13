<script lang="ts">
import { Anchor, Crosshair } from '@lucide/svelte';
import { untrack } from 'svelte';
import {
  type AnchorMode,
  type AnchorWatch,
  CAPTURE_MARGIN_M,
  capturedRadius,
  MIN_RADIUS_M,
} from '$entities/anchor';
import type { UnitsStore } from '$entities/units';
import type { OwnVessel } from '$entities/vessel';
import { feetToMeters, formatLengthOr, lengthUnit, metersToFeet, PLACEHOLDER } from '$shared/lib';
import type { AuthController } from '$shared/signalk';
import { createPanelMinimize, InlineConfirm, SlideOver, UnitField } from '$shared/ui';

interface Props {
  auth: AuthController;
  anchor: AnchorWatch;
  vessel: OwnVessel;
  units: UnitsStore;
  // A failed server call (set radius, move, raise), shown until the next anchor action.
  error?: string;
  busy?: boolean;
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
// The radius field deals in the display unit; the entity stays meters, so imperial entries
// convert at the edges and round to whole display units.
const toDisplayUnits = (meters: number) =>
  Math.round(mode === 'imperial' ? (metersToFeet(meters) ?? 0) : meters);
const radiusDisplay = $derived(toDisplayUnits(anchor.radiusMeters ?? anchor.preferredRadiusMeters));
const minRadiusDisplay = $derived(toDisplayUnits(MIN_RADIUS_M));
const distanceText = $derived(formatLengthOr(distance, mode, 0));
const radiusText = $derived(watching ? formatLengthOr(anchor.radiusMeters, mode, 0) : PLACEHOLDER);
const depthText = $derived(formatLengthOr(vessel.depthMeters, mode, 1));
const captureTitle = $derived(
  `Set the radius to the current distance plus a ${formatLengthOr(CAPTURE_MARGIN_M, mode, 0)} ${unit} margin`,
);

const MODE_STATUS: Record<AnchorMode, string> = {
  server: 'Watching on the server. The alarm keeps running when Binnacle is closed.',
  client: 'Watching in this browser only. Keep Binnacle open for the alarm.',
  off: 'No anchor down.',
};
const statusLine = $derived(
  anchor.degraded
    ? 'Warning: GPS fix lost. Browser drag detection has stopped.'
    : anchor.fixLost
      ? 'GPS fix lost on this display. The server anchor watch remains active.'
      : anchor.dragging
        ? 'Anchor dragging: the boat is outside the watch radius.'
        : MODE_STATUS[anchor.mode],
);

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
    <p class="muted-note" role="status">
      Server anchor changes need a write token. A browser-only watch remains available when no
      server watch is active.
    </p>
  {/if}
  <p class="muted-note">
    Drop the anchor to start a drift alarm that sounds if the boat swings past the watch radius.
  </p>
  <p
    class="muted-note status"
    class:status--alarm={anchor.dragging || anchor.degraded}
    role={anchor.dragging || anchor.degraded ? 'alert' : 'status'}
  >
    {statusLine}
  </p>
  <dl class="stat-grid">
    <dt>From anchor</dt>
    <dd><span class="num">{distanceText}</span><span class="unit">{unit}</span></dd>
    <dt>Radius</dt>
    <dd><span class="num">{radiusText}</span><span class="unit">{unit}</span></dd>
    {#if vessel.depthMeters !== undefined}
      <dt>Depth</dt>
      <dd><span class="num">{depthText}</span><span class="unit">{unit}</span></dd>
    {/if}
  </dl>
  <UnitField
    label="Watch radius"
    {unit}
    min={minRadiusDisplay}
    step={1}
    ariaLabel="Watch radius in {mode === 'imperial' ? 'feet' : 'meters'}"
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
</style>

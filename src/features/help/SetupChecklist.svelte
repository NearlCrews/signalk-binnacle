<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import Circle from '@lucide/svelte/icons/circle';

interface Props {
  // A nautical chart layer is visible, so the view is a chart and not a reference map.
  chartOn: boolean;
  // The server has published a position at least once this session.
  gpsSeen: boolean;
  // Binnacle can write to the server (routes, waypoints, tracks, alarms, and course).
  writeAllowed: boolean;
  // Alarm audio is primed, so an armed watch can actually sound.
  soundEnabled: boolean;
  // Whether the server can store saved data at all: undefined while the probe has not answered,
  // which renders as neither done nor a dead end.
  savedDataProvisioned?: boolean;
  onOpenLayers: () => void;
  onRequestWrite: () => void;
  onEnableSound: () => void;
}

const {
  chartOn,
  gpsSeen,
  writeAllowed,
  soundEnabled,
  savedDataProvisioned,
  onOpenLayers,
  onRequestWrite,
  onEnableSound,
}: Props = $props();

// Visibility is decided by the durable rows only. GPS and alarm sound are session state (audio
// priming resets on every load, and a fix arrives seconds in), so gating on them would render the
// checklist at the top of Help on every visit of a fully set-up boat and then have it vanish
// mid-read. They still render, with live checks.
const durableDone = $derived(chartOn && writeAllowed && savedDataProvisioned !== false);
const rows = $derived([
  {
    id: 'chart',
    done: chartOn,
    label: 'Turn on a nautical chart',
    detail: 'The base map is reference only until a chart source covering your waters is on.',
    action: chartOn ? undefined : { label: 'Open Layers and charts', run: onOpenLayers },
  },
  {
    id: 'gps',
    done: gpsSeen,
    label: 'See a GPS position',
    detail: gpsSeen
      ? 'The server is publishing a position.'
      : 'No position yet. Check the GPS source in the Data Browser of the Signal K server admin UI; see GPS readiness below.',
    action: undefined,
  },
  {
    id: 'write',
    done: writeAllowed,
    label: 'Get read and write access',
    detail: writeAllowed
      ? 'Routes, waypoints, tracks, alarms, and course can be saved to the boat.'
      : 'Read-only access keeps every view working and blocks saving.',
    action: writeAllowed
      ? undefined
      : { label: 'Request read and write access', run: onRequestWrite },
  },
  {
    id: 'sound',
    done: soundEnabled,
    label: 'Enable alarm sound',
    detail: soundEnabled
      ? 'Alarms can sound on this display.'
      : 'Browsers block audio until a display is touched once. Alarms stay visual either way.',
    action: soundEnabled ? undefined : { label: 'Enable alarm sound now', run: onEnableSound },
  },
  {
    id: 'storage',
    done: savedDataProvisioned === true,
    label: 'Enable saved data on the server',
    detail: savedDataDetail(savedDataProvisioned),
    action: undefined,
  },
]);

// The storage line for each answer of the tri-state probe. Undefined is "still checking", which
// must never read as either verdict: telling a navigator their server cannot save is a false alarm
// before the probe answers, and telling them it can is worse.
function savedDataDetail(provisioned: boolean | undefined): string {
  if (provisioned === false) {
    return 'This server has no resources provider, so routes and waypoints cannot be saved. An administrator can enable the built-in Resources Provider in the Signal K admin UI.';
  }
  if (provisioned === true) return 'The server stores routes, waypoints, and tracks.';
  return 'Checking whether this server stores routes and waypoints.';
}
</script>

{#if !durableDone}
  <section class="panel-section" aria-label="Get set up">
    <h3 class="caps-label">Get set up</h3>
    <ul class="bare-list checklist">
      {#each rows as row (row.id)}
        <li class="check-row" class:is-done={row.done}>
          <span class="mark" aria-hidden="true">
            {#if row.done}
              <Check size={16} />
            {:else}
              <Circle size={16} />
            {/if}
          </span>
          <span class="body">
            <span class="row-label">{row.label}{row.done ? ' (done)' : ''}</span>
            <span class="muted-note">{row.detail}</span>
            {#if row.action}
              <button type="button" class="btn btn-ghost" onclick={row.action.run}>
                {row.action.label}
              </button>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
.checklist {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.check-row {
  display: flex;
  align-items: start;
  gap: var(--space-2);
}
.check-row .body {
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: var(--space-1);
  min-inline-size: 0;
}
.row-label {
  font-weight: 600;
}
.mark {
  display: inline-flex;
  padding-block-start: 0.1rem;
}
/* A finished row stays listed so the checklist reads as progress, and recedes so the open rows
   are what the eye lands on. */
.check-row.is-done {
  color: var(--text-muted);
}
.check-row.is-done .mark {
  color: var(--ok);
}
</style>

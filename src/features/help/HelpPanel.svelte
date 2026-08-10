<script lang="ts">
import { SlideOver, WriteAccessNote } from '$shared/ui';

// Help and helm setup: the first-run orientation, the advisory boundary, the setup routes into
// the real panels (never duplicated controls), the operating-context starter profiles, and the
// plain-language glossary behind every abbreviation the helm shows.
interface Props {
  // The skippable first-run orientation banner renders once per device; dismissing it persists.
  firstRun: boolean;
  onDismissOrientation: () => void;
  writeBlocked: boolean;
  requestingWrite: boolean;
  onRequestWrite: () => void;
  audioBlocked: boolean;
  onEnableSound: () => void;
  onOpenLayers: () => void;
  onOpenProfiles: () => void;
  onOpenAlarms: () => void;
  onResetHints: () => void;
  onClose: () => void;
  onBack?: () => void;
}

const {
  firstRun,
  onDismissOrientation,
  writeBlocked,
  requestingWrite,
  onRequestWrite,
  audioBlocked,
  onEnableSound,
  onOpenLayers,
  onOpenProfiles,
  onOpenAlarms,
  onResetHints,
  onClose,
  onBack,
}: Props = $props();

let hintsReset = $state(false);

const GLOSSARY: Array<{ term: string; meaning: string }> = [
  { term: 'SOG', meaning: 'Speed over ground: the GPS-measured speed of the boat.' },
  {
    term: 'COG',
    meaning: 'Course over ground: the direction the boat actually moves, from GPS.',
  },
  { term: 'HDG', meaning: 'Heading: the direction the bow points, from a compass.' },
  {
    term: 'AIS',
    meaning: 'Automatic Identification System: position broadcasts from nearby vessels.',
  },
  {
    term: 'CPA',
    meaning:
      'Closest point of approach: how near another vessel will pass if both hold course and speed.',
  },
  { term: 'TCPA', meaning: 'Time to the closest point of approach.' },
  {
    term: 'VMG',
    meaning: 'Velocity made good: the part of the speed that actually closes on the destination.',
  },
  { term: 'XTE', meaning: 'Cross-track error: how far off the planned leg the boat is.' },
  { term: 'TTG', meaning: 'Time to go to the next waypoint at the current progress.' },
  { term: 'RTE', meaning: 'Route distance still to run across the legs ahead.' },
  {
    term: 'ETA',
    meaning: 'Estimated time of arrival, from current progress plus the planning speed.',
  },
  {
    term: 'KIP',
    meaning:
      'A separate instrument-dashboard webapp some Signal K servers install; its launcher opens it in a new tab.',
  },
];

const CONTEXTS: Array<{ name: string; role: string }> = [
  {
    name: 'Coastal day',
    role: 'Daylight coasting: the day theme with the standard chart layers.',
  },
  {
    name: 'Night passage',
    role: 'Underway after dark: the night-red theme, tuned to protect night vision.',
  },
  {
    name: 'At anchor',
    role: 'Riding at anchor: anchor-watch surfaces first and a calmer chart.',
  },
];
</script>

<SlideOver title="Help and helm setup" closeLabel="Close help" bodyFlex {onClose} {onBack}>
  {#if firstRun}
    <div class="alert-note alert-note--filled" role="region" aria-label="Welcome">
      <p>
        Welcome aboard. Binnacle is an advisory chartplotter for Signal K: it helps you see, plan,
        and stay alert, and it never replaces official charts, a lookout, or redundant navigation.
      </p>
      <button type="button" class="btn" onclick={onDismissOrientation}>
        Got it, do not show this again
      </button>
    </div>
  {/if}

  <section class="panel-section" aria-label="Safe use">
    <h3 class="caps-label">Safe use</h3>
    <p class="muted-note">
      Every number here is advisory and only as good as the boat's sensors. Cross-check against
      official charts and keep an independent means of navigation. Alarms, estimates, and cached
      charts never certify that a passage is safe.
    </p>
  </section>

  <section class="panel-section" aria-label="Reference map and nautical charts">
    <h3 class="caps-label">Reference map and nautical charts</h3>
    <p class="muted-note">
      The built-in base map is for reference only; it is not a navigation chart. The badge on the
      chart corner says whether a nautical chart covers the current view. Enable chart sources under
      Layers and charts.
    </p>
    <button type="button" class="btn btn-ghost" onclick={onOpenLayers}>
      Open Layers and charts
    </button>
  </section>

  <section class="panel-section" aria-label="Signal K access">
    <h3 class="caps-label">Signal K access</h3>
    <p class="muted-note">
      Binnacle stores routes, waypoints, tracks, alarms, and profiles on the Signal K server, so it
      needs read/write approval from the server admin. Read-only access keeps every view working and
      disables writes honestly.
    </p>
    {#if writeBlocked}
      <WriteAccessNote
        message="This display has read-only access. Request a read/write token to save and control from here."
        requesting={requestingWrite}
        onRequest={onRequestWrite}
      />
    {/if}
  </section>

  <section class="panel-section" aria-label="GPS readiness">
    <h3 class="caps-label">GPS readiness</h3>
    <p class="muted-note">
      Waiting for GPS means the server has not published a position yet; check the GPS source in the
      server's Data Browser. No GPS fix means the position was lost, and readouts dash rather than
      showing stale numbers as current.
    </p>
  </section>

  <section class="panel-section" aria-label="Alarm sound">
    <h3 class="caps-label">Alarm sound</h3>
    <p class="muted-note">
      Browsers block audio until a display is touched once, so tap anywhere (or the Enable chip)
      after loading a helm display. Alarms stay visual either way, and each alarm separates
      acknowledge, boat-wide silence, and mute-on-this-display.
    </p>
    {#if audioBlocked}
      <button type="button" class="btn btn-ghost" onclick={onEnableSound}>
        Enable alarm sound now
      </button>
    {/if}
    <button type="button" class="btn btn-ghost" onclick={onOpenAlarms}>Open Alarms</button>
  </section>

  <section class="panel-section" aria-label="Man overboard">
    <h3 class="caps-label">Man overboard</h3>
    <p class="muted-note">
      The MOB button marks the spot at the moment it is pressed, asks to confirm, and alarms every
      station. It never changes the course by itself: Steer to MOB is a separate, confirmed action.
    </p>
  </section>

  <section class="panel-section" aria-label="Operating contexts">
    <h3 class="caps-label">Operating contexts</h3>
    <p class="muted-note">
      The starter profiles are operating contexts, not skill levels; each carries its own theme,
      layers, and instrument choices, synced with the Signal K account.
    </p>
    <ul class="bare-list context-list">
      {#each CONTEXTS as context (context.name)}
        <li><b>{context.name}</b>: {context.role}</li>
      {/each}
    </ul>
    <button type="button" class="btn btn-ghost" onclick={onOpenProfiles}>Open Profiles</button>
  </section>

  <section class="panel-section" aria-label="Glossary">
    <h3 class="caps-label">Glossary</h3>
    <dl class="glossary">
      {#each GLOSSARY as entry (entry.term)}
        <dt class="num">{entry.term}</dt>
        <dd>{entry.meaning}</dd>
      {/each}
    </dl>
  </section>

  <section class="panel-section" aria-label="Hints">
    <h3 class="caps-label">Hints</h3>
    <button
      type="button"
      class="btn btn-ghost"
      onclick={() => {
        onResetHints();
        hintsReset = true;
      }}
    >
      Show chart-action hints again
    </button>
    {#if hintsReset}
      <p class="muted-note" role="status">Chart hints will show again after the next reload.</p>
    {/if}
  </section>
</SlideOver>

<style>
.context-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.glossary {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-3);
  margin: 0;
}
.glossary dt {
  font-weight: 600;
}
.glossary dd {
  margin: 0;
  color: var(--text-muted);
}
</style>

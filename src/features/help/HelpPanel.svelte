<script lang="ts">
import type { UpgradeOutcome } from '$shared/signalk';
import { SlideOver, WriteAccessNote } from '$shared/ui';
import SetupChecklist from './SetupChecklist.svelte';

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
  // How the last read and write request ended, so the outcome lands beside the button here too.
  writeOutcome?: UpgradeOutcome;
  audioBlocked: boolean;
  onEnableSound: () => void;
  // Live setup state for the checklist: a nautical chart layer is visible, the server has ever
  // published a position, and whether it stores saved data (undefined while the probe is out).
  chartOn?: boolean;
  gpsSeen?: boolean;
  savedDataProvisioned?: boolean;
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
  writeOutcome,
  audioBlocked,
  onEnableSound,
  chartOn = false,
  gpsSeen = false,
  savedDataProvisioned,
  onOpenLayers,
  onOpenProfiles,
  onOpenAlarms,
  onResetHints,
  onClose,
  onBack,
}: Props = $props();

let hintsReset = $state(false);

const GLOSSARY: Array<{ term: string; meaning: string; word?: boolean }> = [
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
    term: 'Keel',
    meaning: 'Depth below the keel: the water under the deepest part of the boat.',
    word: true,
  },
  { term: 'Surface', meaning: 'Depth below the waterline.', word: true },
  {
    term: 'Xducer',
    meaning:
      'Depth below the transducer, the echo-sounder sensor in the hull, with no keel or waterline correction.',
    word: true,
  },
  {
    term: 'Signal K',
    meaning:
      'The open marine data server this display connects to; its admin UI manages security, plugins, and data sources.',
    word: true,
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

  <!-- After the advisory framing, never before it: the safety orientation leads. -->
  <SetupChecklist
    {chartOn}
    {gpsSeen}
    writeAllowed={!writeBlocked}
    soundEnabled={!audioBlocked}
    {savedDataProvisioned}
    {onOpenLayers}
    {onRequestWrite}
    {onEnableSound}
  />

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
      needs read and write approval from the server admin. Read-only access keeps every view working
      and disables writes honestly.
    </p>
    <p class="muted-note">
      Connections over plain HTTP are not encrypted, so credentials and boat data can be observed on
      the local network. Enable HTTPS in Signal K to protect them; that also unlocks offline caching
      in the browser.
    </p>
    {#if writeBlocked}
      <WriteAccessNote
        message="This display has read-only access. Request read and write access to save and control from here; the boat's Signal K admin approves it."
        requesting={requestingWrite}
        onRequest={onRequestWrite}
        outcome={writeOutcome}
      />
    {/if}
  </section>

  <section class="panel-section" aria-label="Connection">
    <h3 class="caps-label">Connection</h3>
    <p class="muted-note">
      Reconnecting means the link to the Signal K server dropped; Binnacle retries by itself, and
      the strip's Reconnect button retries now. Connected, no data means the server is reachable but
      nothing has arrived for half a minute; check the server's data sources. Data link failed means
      the retries stopped; tap Retry.
    </p>
  </section>

  <section class="panel-section" aria-label="GPS readiness">
    <h3 class="caps-label">GPS readiness</h3>
    <p class="muted-note">
      Waiting for GPS means the server has not published a position yet; check the GPS source in the
      Data Browser of the Signal K server admin UI. No GPS fix means the position was lost, and
      readouts dash rather than showing stale numbers as current.
    </p>
  </section>

  <section class="panel-section" aria-label="When something looks wrong">
    <h3 class="caps-label">When something looks wrong</h3>
    <p class="muted-note">
      Stale means a value stopped updating: the status strip dashes it, while an instrument tile
      keeps the last number with its age, so how old it is stays visible. While the server link
      itself is down, the strip dims the readouts that pause with it, and Reconnect is the one
      action. Unassessed AIS targets are vessels whose course or motion data is missing or stale, so
      collision risk cannot be computed for them. Tapping a degraded strip chip shows its
      explanation.
    </p>
  </section>

  <section class="panel-section" aria-label="Alarm sound">
    <h3 class="caps-label">Alarm sound</h3>
    <p class="muted-note">
      Browsers block audio until a display is touched once, so tap anywhere after loading a helm
      display; the status strip says so until you do. Alarms stay visual either way, and each alarm
      separates acknowledge, boat-wide silence, and mute-on-this-display.
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
        <!-- The tabular-numeral face suits the acronym terms; plain words keep the text face. -->
        <dt class:num={!entry.word}>{entry.term}</dt>
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

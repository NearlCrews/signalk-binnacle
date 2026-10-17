<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { Clock, MINUTE_MS } from '$shared/lib';
import type { AuthController } from '$shared/signalk';
import { LoadNote, SlideOver, WriteAccessNote } from '$shared/ui';
import type { CompanionAiController } from './companion-ai-controller.svelte';
import { analyzerTitle, companionReportTime } from './companion-reports';

interface Props {
  controller: CompanionAiController;
  auth: AuthController;
  onClose: () => void;
  onBack?: () => void;
}

const { controller, auth, onClose, onBack }: Props = $props();

onMount(() => {
  controller.start();
});
const clock = new Clock(MINUTE_MS);
onDestroy(() => {
  controller.stop();
  clock.dispose();
});
</script>

<SlideOver title="AI advisor" closeLabel="Close AI advisor panel" {onClose} {onBack} bodyFlex>
  {#if auth.writeBlocked}
    <WriteAccessNote
      message="This display has read-only access, so analyzers cannot be run from here. Reports still update on the plugin's own schedule."
      requesting={auth.upgrading}
      onRequest={() => void auth.requestWriteAccess()}
      outcome={auth.upgradeOutcome}
    />
  {/if}

  <p class="muted-note">
    Advisory reports from the companion plugin's analyzers about the boat's engines, batteries,
    sensors, and weather. They are AI summaries for review, never navigation truth.
  </p>
  <p class="muted-note">
    Run now sends the analyzer's configured vessel telemetry through OpenRouter to its selected
    model provider and may use shared paid credits. Refresh reports only reads saved reports; it
    does not start an analysis. Check the companion plugin's telemetry and model settings before
    running.
  </p>

  {#if controller.availability === 'absent'}
    <section class="panel-section" aria-label="Companion plugin not detected">
      <h3 class="caps-label">Not detected</h3>
      <p class="muted-note" role="status">
        No reports are on the server. Either the companion plugin is not installed, or it has not
        published a report since the server started.
      </p>
      <p class="muted-note">
        The OpenRouter Companion plugin runs on the Signal K server, reads the boat's telemetry, and
        publishes short advisory reports here on a schedule. An administrator can install and enable
        signalk-openrouter-companion from the Signal K App Store.
      </p>
      <div class="panel-controls">
        <button type="button" class="btn btn-ghost" onclick={() => void controller.refresh()}>
          Check again
        </button>
      </div>
    </section>
  {:else}
    <section class="panel-section" aria-label="Latest reports">
      <h3 class="caps-label">Latest reports</h3>
      {#if controller.availability === 'unavailable'}
        <LoadNote
          state="error"
          message="Companion reports could not be loaded. Anything already received stays listed below."
          onRetry={() => void controller.refresh()}
          retryName="companion reports"
        />
      {/if}
      {#if controller.loading && controller.reports.length === 0}
        <p class="muted-note" role="status">Checking for companion reports…</p>
      {:else if controller.reports.length === 0 && controller.availability === 'available'}
        <p class="muted-note">
          No reports yet. Analyzers publish on their own schedule; check back after the next run.
        </p>
      {/if}
      {#if controller.reports.length > 0}
        <ul class="bare-list card-list">
          {#each controller.reports as report (report.analyzerId)}
            {@const title = analyzerTitle(report.analyzerId)}
            {@const busy = controller.busyAnalyzerIds.has(report.analyzerId)}
            {@const note = controller.ackNoteFor(report.analyzerId)}
            <li class="card-frame">
              <div class="card-head">
                <span class="card-title">{title}</span>
                {#if report.state === 'warn'}
                  <span class="badge badge--warning badge--caps">Report unavailable</span>
                {/if}
                <span class="num when">{companionReportTime(report.timestampMs, clock.now)}</span>
              </div>
              <p class="report-text" class:sev-warning={report.state === 'warn'}>
                {report.message}
              </p>
              <div class="panel-controls">
                <button
                  type="button"
                  class="btn"
                  aria-label={`Run now: ${title}`}
                  disabled={busy || auth.writeBlocked}
                  onclick={() => void controller.runNow(report.analyzerId)}
                >
                  {busy ? 'Running…' : 'Run now'}
                </button>
              </div>
              {#if note}
                <p class="muted-note ack-note" role="status">{note}</p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if controller.availability === 'available'}
        <div class="panel-controls">
          <button type="button" class="btn btn-ghost" onclick={() => void controller.refresh()}>
            Refresh reports
          </button>
        </div>
      {/if}
    </section>
  {/if}
</SlideOver>

<style>
/* The card list, the card inset, the wrapping head, the title, and the trailing time come from the
   shared .card-list in cards.css. */
.report-text {
  margin: 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.ack-note {
  margin: 0;
}
</style>

<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import { formatClockTime, formatMonthDay } from '$shared/lib';
import type { AuthController } from '$shared/signalk';
import { SlideOver, WriteAccessNote } from '$shared/ui';
import type { CompanionAiController } from './companion-ai-controller.svelte';
import { analyzerTitle } from './companion-reports';

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
onDestroy(() => controller.stop());

function whenText(timestampMs: number | undefined): string {
  if (timestampMs === undefined) return '';
  return `${formatClockTime(timestampMs)} ${formatMonthDay(timestampMs)}`;
}
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
        <p class="alert-note" role="alert">
          Companion reports could not be loaded. Anything already received stays listed below.
        </p>
        <div class="panel-controls">
          <button type="button" class="btn" onclick={() => void controller.refresh()}>Retry</button>
        </div>
      {/if}
      {#if controller.loading && controller.reports.length === 0}
        <p class="muted-note" role="status">Checking for companion reports…</p>
      {:else if controller.reports.length === 0 && controller.availability === 'available'}
        <p class="muted-note">
          No reports yet. Analyzers publish on their own schedule; check back after the next run.
        </p>
      {/if}
      {#if controller.reports.length > 0}
        <ul class="bare-list report-list">
          {#each controller.reports as report (report.analyzerId)}
            {@const title = analyzerTitle(report.analyzerId)}
            {@const busy = controller.busyAnalyzerIds.has(report.analyzerId)}
            {@const note = controller.ackNoteFor(report.analyzerId)}
            <li class="card-frame report">
              <div class="report-head">
                <span class="report-title">{title}</span>
                {#if report.state === 'warn'}
                  <span class="caps-label sev-warning">Report unavailable</span>
                {/if}
                {#if report.timestampMs !== undefined}
                  <span class="num when">{whenText(report.timestampMs)}</span>
                {/if}
              </div>
              <p class="report-text" class:sev-warning={report.state === 'warn'}>
                {report.message}
              </p>
              <div class="report-actions">
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
                <p class="muted-note ack" role="status">{note}</p>
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
.report-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.report {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
}
/* The header wraps at 320 px instead of overflowing: title, state, and timestamp each keep their
   own line when squeezed. */
.report-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
}
.report-title {
  font-size: var(--text-md);
  font-weight: 600;
}
.when {
  margin-inline-start: auto;
  color: var(--text-muted);
}
.report-text {
  margin: 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.ack {
  margin: 0;
}
</style>

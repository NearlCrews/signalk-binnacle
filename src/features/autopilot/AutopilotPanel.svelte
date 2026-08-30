<script lang="ts">
import { onDestroy } from 'svelte';
import { DEG_TO_RAD, formatBearingOr, formatSignedAngleOr, PLACEHOLDER } from '$shared/lib';
import type { AuthController } from '$shared/signalk';
import { ConfirmArm, SlideOver, WriteAccessNote } from '$shared/ui';
import { type AutopilotController, autopilotModeLabel } from './autopilot-controller.svelte';

interface Props {
  controller: AutopilotController;
  auth: AuthController;
  onClose: () => void;
  onBack?: () => void;
}

const { controller, auth, onClose, onBack }: Props = $props();

// Engage, disengage, and the sailing maneuvers each arm a timed confirm (a mis-tap on a rolling
// deck must never command steering machinery), and arming one disarms the rest so two armed
// steering commands can never stand at once.
const arms = {
  engage: new ConfirmArm(),
  disengage: new ConfirmArm(),
  tackPort: new ConfirmArm(),
  tackStarboard: new ConfirmArm(),
  gybePort: new ConfirmArm(),
  gybeStarboard: new ConfirmArm(),
};
onDestroy(() => {
  for (const arm of Object.values(arms)) arm.disarm();
});

function tapArmed(key: keyof typeof arms, action: () => void): void {
  if (arms[key].tap()) {
    action();
    return;
  }
  for (const [other, arm] of Object.entries(arms)) {
    if (other !== key) arm.disarm();
  }
}

// A state flip from the pilot itself (another station engaged it, a seaway kicked it off) makes a
// standing armed confirm stale, so it decays immediately rather than waiting out its window.
$effect(() => {
  void controller.engaged;
  arms.engage.disarm();
  arms.disengage.disarm();
});

const writesBlocked = $derived(auth.writeBlocked);
const commandDisabled = $derived(writesBlocked || controller.busy);
const engagedModeName = $derived(
  controller.mode !== null ? `${autopilotModeLabel(controller.mode)} steering` : 'the autopilot',
);
const windMode = $derived(controller.mode?.includes('wind') ?? false);
const targetText = $derived.by(() => {
  if (controller.target === null) return PLACEHOLDER;
  return windMode ? formatSignedAngleOr(controller.target) : formatBearingOr(controller.target);
});

const canTack = $derived(controller.availableActionIds.has('tack'));
const canGybe = $derived(controller.availableActionIds.has('gybe'));

function nudge(degrees: number): void {
  controller.adjustTarget(degrees * DEG_TO_RAD);
}

const NUDGES = [
  { degrees: -10, label: '-10°', name: 'Ten degrees to port' },
  { degrees: -1, label: '-1°', name: 'One degree to port' },
  { degrees: 1, label: '+1°', name: 'One degree to starboard' },
  { degrees: 10, label: '+10°', name: 'Ten degrees to starboard' },
];
</script>

<SlideOver title="Autopilot" closeLabel="Close autopilot panel" {onClose} {onBack} bodyFlex>
  {#if controller.commandError !== null}
    <p class="alert-note" role="alert">{controller.commandError}</p>
  {/if}

  {#if controller.availability === 'available' && writesBlocked}
    <WriteAccessNote
      message="This display has read-only access, so autopilot commands are blocked. Request read and write access; the boat's Signal K admin approves it."
      requesting={auth.upgrading}
      onRequest={() => void auth.requestWriteAccess()}
      outcome={auth.upgradeOutcome}
    />
  {/if}

  <p class="muted-note">Watch and command the boat's autopilot.</p>

  {#if controller.availability === 'unknown'}
    <p class="muted-note" role="status">Checking for an autopilot…</p>
  {:else if controller.availability === 'absent'}
    <section class="panel-section" aria-label="No autopilot yet">
      <h3 class="caps-label">No autopilot yet</h3>
      {#if controller.absentReason === 'no-api'}
        <p class="muted-note">
          This Signal K server does not offer the version 2 Autopilot API, the standard route
          Binnacle commands a pilot through. Updating the server to version 2 adds it.
        </p>
      {:else}
        <p class="muted-note">
          Signal K's Autopilot API lets this display watch and command a pilot, but no autopilot
          provider is registered on the server, so there is nothing to command yet.
        </p>
      {/if}
      <p class="muted-note">
        A provider plugin for your pilot supplies the connection, for example
        pypilot-autopilot-provider for a pypilot. Install and enable it on the Signal K server;
        Binnacle checks again automatically when the connection returns after the restart.
      </p>
    </section>
  {:else if controller.availability === 'auth-required'}
    <section class="panel-section" aria-label="Access needed">
      <h3 class="caps-label">Access needed</h3>
      <WriteAccessNote
        message="Signal K requires access approval before this display can read the autopilot. Request read and write access; the boat's Signal K admin approves it."
        requesting={auth.upgrading}
        onRequest={() => void auth.requestWriteAccess()}
        outcome={auth.upgradeOutcome}
      />
    </section>
  {:else if controller.availability === 'unreachable'}
    <p class="alert-note" role="alert">
      The autopilot service could not be reached. The pilot may still be steering; its last known
      state is not shown because it cannot be trusted.
    </p>
    <button type="button" class="btn" onclick={() => void controller.rehydrate()}>Retry</button>
  {:else}
    {#if controller.devices.length > 1}
      <section class="panel-section" aria-label="Pilot device">
        <h3 class="caps-label">Pilot device</h3>
        <label class="device-field">
          <span class="device-label">Command this pilot</span>
          <select
            class="input"
            value={controller.selectedId}
            onchange={(event) => controller.selectDevice(event.currentTarget.value)}
          >
            {#each controller.devices as device (device.id)}
              <option value={device.id}>
                {device.id}{device.isDefault ? ' (default)' : ''}
              </option>
            {/each}
          </select>
        </label>
      </section>
    {/if}

    <section class="panel-section" aria-label="Pilot status">
      <h3 class="caps-label">Pilot status</h3>
      <dl class="stat-grid">
        <dt>State</dt>
        <dd>
          <span class="num"
            >{controller.pilotState !== null ? autopilotModeLabel(controller.pilotState) : PLACEHOLDER}</span
          ><span class="unit"></span>
        </dd>
        <dt>Mode</dt>
        <dd>
          <span class="num"
            >{controller.mode !== null ? autopilotModeLabel(controller.mode) : PLACEHOLDER}</span
          ><span class="unit"></span>
        </dd>
        <dt>Target</dt>
        <dd>
          <span class="num">{targetText}</span
          ><span class="unit">{controller.target !== null ? '°' : ''}</span>
        </dd>
      </dl>
      {#if controller.engaged}
        <p class="muted-note" role="status">The autopilot is engaged and steering.</p>
      {:else}
        <p class="muted-note" role="status">The autopilot is on standby: hand steering.</p>
      {/if}
    </section>

    <section class="panel-section" aria-label="Steering">
      <h3 class="caps-label">Steering</h3>
      {#if controller.engaged}
        <button
          type="button"
          class="btn btn-danger"
          disabled={commandDisabled}
          onclick={() => tapArmed('disengage', () => void controller.disengage())}
        >
          {controller.pendingCommand === 'disengage'
            ? 'Disengaging…'
            : arms.disengage.armed
              ? 'Tap again to disengage: take the helm'
              : 'Disengage autopilot'}
        </button>
      {:else}
        <button
          type="button"
          class="btn btn-primary"
          disabled={commandDisabled}
          onclick={() => tapArmed('engage', () => void controller.engage())}
        >
          {controller.pendingCommand === 'engage'
            ? 'Engaging…'
            : arms.engage.armed
              ? `Tap again to engage ${engagedModeName}`
              : 'Engage autopilot'}
        </button>
      {/if}
    </section>

    <section class="panel-section" aria-label="Target">
      <h3 class="caps-label">Target</h3>
      <div class="nudges" role="group" aria-label="Adjust target">
        {#each NUDGES as step (step.degrees)}
          <button
            type="button"
            class="btn btn--grow"
            aria-label={step.name}
            disabled={!controller.engaged || writesBlocked}
            onclick={() => nudge(step.degrees)}
          >
            {step.label}
          </button>
        {/each}
      </div>
      {#if controller.engaged}
        <p class="muted-note muted-note--xs">
          Minus turns to port, plus to starboard. Taps add up while a change is being sent.
        </p>
      {:else}
        <p class="muted-note muted-note--xs">Target changes need the pilot engaged.</p>
      {/if}
    </section>

    {#if controller.modes.length > 1}
      <section class="panel-section" aria-label="Steering mode">
        <h3 class="caps-label">Steering mode</h3>
        {#if controller.modes.length <= 4}
          <div class="segmented" role="group" aria-label="Steering mode">
            {#each controller.modes as option (option)}
              <button
                type="button"
                class="btn"
                class:is-on={controller.mode === option}
                aria-pressed={controller.mode === option}
                disabled={commandDisabled}
                onclick={() => void controller.setMode(option)}
              >
                {autopilotModeLabel(option)}
              </button>
            {/each}
          </div>
        {:else}
          <label class="device-field">
            <span class="device-label">Steer by</span>
            <select
              class="input"
              value={controller.mode ?? ''}
              disabled={commandDisabled}
              onchange={(event) => void controller.setMode(event.currentTarget.value)}
            >
              {#each controller.modes as option (option)}
                <option value={option}>{autopilotModeLabel(option)}</option>
              {/each}
            </select>
          </label>
        {/if}
        <p class="muted-note muted-note--xs">
          What the pilot steers by: a compass heading, a GPS course, or the wind angle, as the
          provider offers them.
        </p>
      </section>
    {/if}

    {#if canTack || canGybe}
      <section class="panel-section" aria-label="Sailing maneuvers">
        <h3 class="caps-label">Sailing maneuvers</h3>
        {#if canTack}
          <div class="nudges" role="group" aria-label="Tack">
            <button
              type="button"
              class="btn btn--grow"
              disabled={commandDisabled}
              onclick={() => tapArmed('tackPort', () => void controller.tack('port'))}
            >
              {arms.tackPort.armed ? 'Tap again to tack to port' : 'Tack port'}
            </button>
            <button
              type="button"
              class="btn btn--grow"
              disabled={commandDisabled}
              onclick={() => tapArmed('tackStarboard', () => void controller.tack('starboard'))}
            >
              {arms.tackStarboard.armed ? 'Tap again to tack to starboard' : 'Tack starboard'}
            </button>
          </div>
        {/if}
        {#if canGybe}
          <div class="nudges" role="group" aria-label="Gybe">
            <button
              type="button"
              class="btn btn--grow"
              disabled={commandDisabled}
              onclick={() => tapArmed('gybePort', () => void controller.gybe('port'))}
            >
              {arms.gybePort.armed ? 'Tap again to gybe to port' : 'Gybe port'}
            </button>
            <button
              type="button"
              class="btn btn--grow"
              disabled={commandDisabled}
              onclick={() => tapArmed('gybeStarboard', () => void controller.gybe('starboard'))}
            >
              {arms.gybeStarboard.armed ? 'Tap again to gybe to starboard' : 'Gybe starboard'}
            </button>
          </div>
        {/if}
      </section>
    {/if}
  {/if}

  <p class="muted-note">
    Binnacle is advisory: it sends requests to the autopilot but cannot guarantee the pilot acts on
    them. The helm remains responsible for keeping watch and steering safely.
  </p>
</SlideOver>

<style>
.nudges {
  display: flex;
  gap: var(--space-2);
}
.device-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.device-label {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
</style>

<script lang="ts">
import type { AnchorWatch } from '$entities/anchor';
import type { CollisionAssessment } from '$entities/collision';
import type { MobStore } from '$entities/mob';
import type { ActiveNotification } from '$entities/notifications';
import type { UnitsStore } from '$entities/units';
import { AnchorStrip } from '$features/anchor-watch';
import {
  AlarmStrip,
  DangerStrip,
  isRaisedNotification,
  worstRaisedNotification,
} from '$features/lookout';
import { MobStrip } from '$features/mob';
import { type SafetyCondition, SafetyStack } from './safety-stack.svelte';

interface ChipCondition extends SafetyCondition {
  label: string;
  // The chip's accessible name, worded per condition ("Collision danger", "Anchor alarm").
  chipAria: string;
  grade: 'alarm' | 'warning';
  count?: number;
}

interface Props {
  units: UnitsStore;
  anchor: AnchorWatch;
  onAnchorRaise: () => void;
  collision: CollisionAssessment;
  collisionMuted: boolean;
  onToggleCollisionMute: () => void;
  // Open a named collision contact's AIS detail straight from the strip row.
  onSelectAisTarget?: (id: string) => void;
  mob: MobStore;
  onMobSteer: () => void;
  onMobCancel: () => void;
  mobPublishWarning?: string;
  // The active navigation destination name, for the steer confirmation to say what it replaces.
  mobActiveCourse?: string;
  genericAlarms: ActiveNotification[];
  genericSounding: boolean;
  genericLocallyMuted: boolean;
  writeBlocked: boolean;
  onSilence?: (notification: ActiveNotification) => void;
  onAcknowledge?: (notification: ActiveNotification) => void;
  onMuteGenericHere: () => void;
  onOpenAlarms: () => void;
}

const {
  units,
  anchor,
  onAnchorRaise,
  collision,
  collisionMuted,
  onToggleCollisionMute,
  onSelectAisTarget,
  mob,
  onMobSteer,
  onMobCancel,
  mobPublishWarning,
  mobActiveCourse,
  genericAlarms,
  genericSounding,
  genericLocallyMuted,
  writeBlocked,
  onSilence,
  onAcknowledge,
  onMuteGenericHere,
  onOpenAlarms,
}: Props = $props();

const contacts = $derived(collision.assessment.contacts);
const collisionDanger = $derived(contacts[0]?.severity === 'danger');
const raisedGeneric = $derived(genericAlarms.filter(isRaisedNotification));
const genericQuieted = $derived(
  !genericSounding &&
    (genericLocallyMuted || raisedGeneric.every((notification) => notification.silenced === true)),
);

// The default priority order: MOB, collision danger, anchor drag or lost protection, generic
// emergency or alarm, collision warning; acknowledged conditions sort after all of them.
const conditions = $derived<ChipCondition[]>([
  {
    id: 'mob',
    active: mob.active,
    rank: 0,
    acknowledged: mob.acknowledged,
    label: 'MOB',
    chipAria: 'Man overboard',
    grade: 'alarm',
  },
  {
    id: 'collision',
    active: contacts.length > 0,
    rank: collisionDanger ? 1 : 4,
    acknowledged: collision.suppressed && !collision.escalating,
    label: 'Collision',
    chipAria: collisionDanger ? 'Collision danger' : 'Collision warning',
    grade: collisionDanger ? 'alarm' : 'warning',
    count: contacts.length,
  },
  {
    id: 'anchor',
    active: anchor.dragging || anchor.blindCause !== undefined,
    rank: 2,
    acknowledged: anchor.dragging ? anchor.acknowledged : anchor.blindAcknowledged,
    label: 'Anchor',
    chipAria: 'Anchor alarm',
    grade: 'alarm',
  },
  {
    id: 'generic',
    active: worstRaisedNotification(genericAlarms) !== undefined,
    rank: 3,
    acknowledged: genericQuieted,
    label: 'Alarms',
    chipAria: 'Alarms',
    grade: 'alarm',
    count: raisedGeneric.length,
  },
]);

const stack = new SafetyStack();
$effect(() => {
  stack.update(conditions);
});

const chips = $derived(
  conditions.filter((condition) => condition.active && condition.id !== stack.shownId),
);

// Restore the pre-emergency focus target when the final condition clears, but only when focus is
// still on the body or inside the rail: a navigator who moved on must not have focus yanked back.
let railRoot = $state<HTMLElement | undefined>();
let previousFocus: HTMLElement | undefined;
let hadActive = false;
$effect(() => {
  const nowActive = stack.shownId !== undefined;
  if (nowActive && !hadActive) {
    const focused = document.activeElement;
    previousFocus =
      focused instanceof HTMLElement && focused !== document.body ? focused : undefined;
  } else if (!nowActive && hadActive) {
    const focused = document.activeElement;
    const focusIsFree =
      focused === null || focused === document.body || (railRoot?.contains(focused) ?? false);
    if (focusIsFree && previousFocus?.isConnected) previousFocus.focus();
    previousFocus = undefined;
  }
  hadActive = nowActive;
});

function chipLabel(condition: ChipCondition): string {
  const count = condition.count !== undefined && condition.count > 1 ? ` (${condition.count})` : '';
  return `${condition.label}${count}`;
}

function chipDescription(condition: ChipCondition): string {
  const count =
    condition.count !== undefined && condition.count > 1 ? `, ${condition.count} raised` : '';
  const acked = condition.acknowledged ? ', acknowledged' : '';
  return `${condition.chipAria}${count}${acked}, show details`;
}
</script>

{#if stack.shownId !== undefined}
  <div class="rail" bind:this={railRoot}>
    {#if chips.length > 0}
      <div class="chips" role="group" aria-label="Other active alerts">
        {#each chips as condition (condition.id)}
          <button
            type="button"
            class="btn btn-pill chip"
            class:chip--warning={condition.grade === 'warning'}
            class:chip--acked={condition.acknowledged}
            aria-label={chipDescription(condition)}
            onclick={() => stack.inspect(condition.id)}
          >
            {chipLabel(condition)}
          </button>
        {/each}
      </div>
    {/if}
    {#if stack.shownId === 'mob'}
      <MobStrip
        {mob}
        {units}
        onSteer={onMobSteer}
        onCancel={onMobCancel}
        publishWarning={mobPublishWarning}
        activeCourse={mobActiveCourse}
      />
    {:else if stack.shownId === 'collision'}
      <DangerStrip
        {collision}
        muted={collisionMuted}
        onToggleMute={onToggleCollisionMute}
        onSelectContact={onSelectAisTarget}
      />
    {:else if stack.shownId === 'anchor'}
      <AnchorStrip {anchor} {units} onRaise={onAnchorRaise} />
    {:else if stack.shownId === 'generic'}
      <AlarmStrip
        notifications={genericAlarms}
        sounding={genericSounding}
        locallyMuted={genericLocallyMuted}
        {writeBlocked}
        {onSilence}
        {onAcknowledge}
        onMuteHere={onMuteGenericHere}
        {onOpenAlarms}
      />
    {/if}
  </div>
{/if}

<style>
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  inline-size: 100%;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
}
/* An emergency chip reads in its condition's grade color, mirroring the strip it stands for. */
.chip {
  color: var(--alarm);
  border-color: var(--alarm);
  font-weight: 600;
  background: var(--surface-overlay);
}
.chip--warning {
  color: var(--warning);
  border-color: var(--warning);
}
/* Acknowledged conditions dim the same way an acknowledged strip does. */
.chip--acked {
  opacity: 0.62;
}
</style>

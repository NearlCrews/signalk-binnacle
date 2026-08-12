<script lang="ts">
import UserCog from '@lucide/svelte/icons/user-cog';
import type { Profile } from '$entities/profile';
import { AnchoredMenu, createMenuFocusMachine } from '$shared/ui';

interface Props {
  active: Profile | undefined;
  profiles: Profile[];
  // A profile change arrived from another station and is waiting for a decision in the panel.
  hasUpdate?: boolean;
  onSelect: (id: string) => void;
  onManage: () => void;
}

const { active, profiles, hasUpdate = false, onSelect, onManage }: Props = $props();

let menuOpen = $state(false);
let trigger = $state<HTMLButtonElement>();
let surface = $state<HTMLElement>();

const machine = createMenuFocusMachine({
  surface: () => surface,
  trigger: () => trigger,
  requestClose: () => {
    menuOpen = false;
  },
});

$effect(() => machine.syncOpen(menuOpen));

const activeId = $derived(active?.id);
const label = $derived(active?.name ?? 'No profile');
// One description for both the screen-reader label and the hover title: the name is clipped at 9rem
// and hidden below 600px, so the title is the only way to read a long or hidden name.
const description = $derived(
  `${active ? `Profile ${active.name}` : 'No profile'}${hasUpdate ? ', update available' : ''}, switch profile`,
);

function select(id: string): void {
  onSelect(id);
  machine.close();
}

function manage(): void {
  onManage();
  machine.close();
}
</script>

<div class="profile-switcher">
  <button
    type="button"
    class="btn btn-pill switcher"
    class:no-profile={!active}
    aria-label={description}
    title={description}
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    bind:this={trigger}
    onclick={() => (menuOpen = !menuOpen)}
  >
    <UserCog size={16} aria-hidden="true" />
    <span class="name truncate">{label}</span>
    {#if hasUpdate}
      <span class="update-dot" aria-hidden="true"></span>
    {/if}
  </button>
  <AnchoredMenu
    open={menuOpen}
    onClose={() => machine.close()}
    backdropLabel="Close profile menu"
    surfaceClass="popover-card menu-surface profile-switcher-menu"
    anchor={trigger}
    ariaLabel="Switch profile"
    role="menu"
    bind:surfaceRef={surface}
    onKeydown={machine.handleKeydown}
    onFocusLeft={() => machine.close()}
  >
    {#each profiles as profile (profile.id)}
      <button
        type="button"
        role="menuitem"
        class="menu-item"
        class:is-on={profile.id === activeId}
        aria-current={profile.id === activeId ? 'true' : undefined}
        onclick={() => select(profile.id)}
      >
        <span class="row-name truncate">{profile.name}</span>
      </button>
    {/each}
    <!-- Profiles are live documents, not presets: a navigator arriving from preset-shaped systems
         expects switching back to restore the original, so state the rule where switching happens. -->
    <p class="switcher-note muted-note">Changes save to the active profile automatically.</p>
    <button type="button" role="menuitem" class="menu-item manage" onclick={manage}>
      Manage profiles
    </button>
  </AnchoredMenu>
</div>

<style>
.switcher-note {
  margin: 0;
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
}
.profile-switcher {
  position: relative;
  display: flex;
}
/* The base look is the shared global .btn .btn-pill; only the long-name clip width, the muted
   no-profile text, and the pending-update dot are switcher-specific. */
.switcher {
  flex: none;
  min-inline-size: var(--control-size);
}
.name {
  max-inline-size: 9rem;
}
.no-profile .name {
  color: var(--text-muted);
}
/* The waiting-update dot rides beside the name and survives the phone breakpoint that hides the
   name, so the only ambient signal of a remote change stays visible on a narrow bar. The label
   carries the same fact for assistive tech, so the dot itself is decorative. */
.update-dot {
  flex: none;
  inline-size: 0.5rem;
  block-size: 0.5rem;
  border-radius: 50%;
  background: var(--accent);
}
.row-name {
  min-inline-size: 0;
}

:global(.profile-switcher-menu) {
  --menu-width: 14rem;
}
/* A hairline above Manage profiles separates switching from managing. */
:global(.profile-switcher-menu .manage) {
  margin-block-start: var(--space-1);
  border-block-start: 1px solid var(--border);
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
}

@media (max-width: 600px) {
  .name {
    display: none;
  }
}
</style>

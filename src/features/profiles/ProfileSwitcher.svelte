<script lang="ts">
import UserCog from '@lucide/svelte/icons/user-cog';
import type { Profile } from '$entities/profile';

interface Props {
  active: Profile | undefined;
  // A profile change arrived from another station and is waiting for a decision in the panel.
  hasUpdate?: boolean;
  onClick: () => void;
}

const { active, hasUpdate = false, onClick }: Props = $props();

const label = $derived(active?.name ?? 'No profile');
// One description for both the screen-reader label and the hover title: the name is clipped at 9rem
// and hidden below 600px, so the title is the only way to read a long or hidden name.
const description = $derived(
  `${active ? `Profile ${active.name}` : 'No profile'}${hasUpdate ? ', update available' : ''}, open profiles`,
);
</script>

<button
  type="button"
  class="btn btn-pill switcher"
  class:no-profile={!active}
  aria-label={description}
  title={description}
  onclick={onClick}
>
  <UserCog size={16} aria-hidden="true" />
  <span class="name">{label}</span>
  {#if hasUpdate}
    <span class="update-dot" aria-hidden="true"></span>
  {/if}
</button>

<style>
/* The base look is the shared global .btn .btn-pill; only the long-name ellipsis, the muted
   no-profile text, and the pending-update dot are switcher-specific. */
.switcher {
  flex: none;
  min-inline-size: var(--control-size);
}
.name {
  overflow: hidden;
  max-inline-size: 9rem;
  text-overflow: ellipsis;
  white-space: nowrap;
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
@media (max-width: 600px) {
  .name {
    display: none;
  }
}
</style>

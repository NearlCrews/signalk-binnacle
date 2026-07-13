<script lang="ts">
import { UserCog } from '@lucide/svelte';
import type { Profile } from '$entities/profile';

interface Props {
  active: Profile | undefined;
  isDirty: boolean;
  onClick: () => void;
}

const { active, isDirty, onClick }: Props = $props();

const label = $derived(active?.name ?? 'No profile');
// The accessible name carries the edited state explicitly, since the visual dot alone is not announced.
const ariaLabel = $derived(
  active
    ? `Profile ${active.name}${isDirty ? ', edited' : ''}, open profiles`
    : 'No profile, open profiles',
);
</script>

<button
  type="button"
  class="btn btn-pill switcher"
  class:no-profile={!active}
  aria-label={ariaLabel}
  title="Profiles"
  onclick={onClick}
>
  <UserCog size={16} aria-hidden="true" />
  <span class="name">{label}</span>
  {#if isDirty}
    <span class="dot" aria-hidden="true"></span>
  {/if}
</button>

<style>
/* The base look is the shared global .btn .btn-pill; only the long-name ellipsis, the muted
   no-profile text, and the unsaved-changes dot are switcher-specific. */
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
/* A small accent dot signaling the live settings have drifted from the saved profile. */
.dot {
  flex-shrink: 0;
  inline-size: 0.4rem;
  block-size: 0.4rem;
  border-radius: var(--radius-pill);
  background: var(--accent);
}
@media (max-width: 600px) {
  .name {
    display: none;
  }
}
</style>

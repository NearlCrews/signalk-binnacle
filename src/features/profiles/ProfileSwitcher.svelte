<script lang="ts">
import { UserCog } from '@lucide/svelte';
import type { Profile } from '$entities/profile';

interface Props {
  active: Profile | undefined;
  onClick: () => void;
}

const { active, onClick }: Props = $props();

const label = $derived(active?.name ?? 'No profile');
const ariaLabel = $derived(
  active ? `Profile ${active.name}, open profiles` : 'No profile, open profiles',
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
</button>

<style>
/* The base look is the shared global .btn .btn-pill; only the long-name ellipsis and the muted
   no-profile text are switcher-specific. */
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
@media (max-width: 600px) {
  .name {
    display: none;
  }
}
</style>

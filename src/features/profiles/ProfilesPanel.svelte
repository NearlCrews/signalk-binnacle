<script lang="ts">
import Check from '@lucide/svelte/icons/check';
import Download from '@lucide/svelte/icons/download';
import Save from '@lucide/svelte/icons/save';
import SquarePen from '@lucide/svelte/icons/square-pen';
import Star from '@lucide/svelte/icons/star';
import Trash2 from '@lucide/svelte/icons/trash-2';
import Upload from '@lucide/svelte/icons/upload';
import {
  MAX_PROFILES,
  type PortableProfileSettingKey,
  type Profile,
  type ProfileSyncState,
} from '$entities/profile';
import type { UnitsStore } from '$entities/units';
import type { PrivacyReport } from '$shared/privacy';
import type { AuthController } from '$shared/signalk';
import {
  ArmedRow,
  defaultSaveName,
  InlineConfirm,
  NameEntry,
  OverflowActions,
  pickTextFile,
  readErrorMessage,
  SavedList,
  SlideOver,
  WriteAccessNote,
} from '$shared/ui';
import DevicePrivacySection from './DevicePrivacySection.svelte';
import { type ImportedProfile, parseProfilesJson } from './profile-io';
import { profileChangeSummary } from './setting-labels';

interface Props {
  auth: AuthController;
  // The display-unit resolution, so the panel can say where units come from: the server's
  // preference when it publishes one, or this device profile's documented fallback otherwise.
  units: UnitsStore;
  profiles: Profile[];
  activeId: string | undefined;
  defaultId: string | undefined;
  syncState: ProfileSyncState;
  remoteUpdateAvailable: boolean;
  // Which portable settings the pending remote update would change, so the prompt is not a blind
  // choice between two destructive actions.
  remoteUpdateChanges: readonly PortableProfileSettingKey[];
  onRetrySync: () => void;
  onApply: (id: string) => void;
  onApplyRemoteUpdate: () => void;
  onKeepCurrentSetup: () => void;
  onSaveNew: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onSetDefault: (id: string) => void;
  // Download a profile as a JSON file, and import profiles from the text of a JSON file.
  onExport: (id: string) => void;
  onImport: (profiles: ImportedProfile[]) => number;
  onForgetCredentials: () => Promise<PrivacyReport>;
  onEraseAllLocalData: () => Promise<PrivacyReport>;
  onClose: () => void;
  onBack?: () => void;
}

const UNIT_MODES = ['metric', 'imperial'] as const;

const {
  auth,
  units,
  profiles,
  activeId,
  defaultId,
  syncState,
  remoteUpdateAvailable,
  remoteUpdateChanges,
  onRetrySync,
  onApply,
  onApplyRemoteUpdate,
  onKeepCurrentSetup,
  onSaveNew,
  onRename,
  onRemove,
  onSetDefault,
  onExport,
  onImport,
  onForgetCredentials,
  onEraseAllLocalData,
  onClose,
  onBack,
}: Props = $props();

const changeSummary = $derived(profileChangeSummary(remoteUpdateChanges));
const atProfileLimit = $derived(profiles.length >= MAX_PROFILES);

// Naming a new profile or renaming an existing one happens inline through NameEntry rather than a
// native prompt. One state drives both: 'new' for the top Save button, or a rename keyed by id.
let naming = $state<{ mode: 'new' } | { mode: 'rename'; id: string } | null>(null);
function confirmName(value: string): void {
  if (naming === null) return;
  if (naming.mode === 'new') {
    onSaveNew(value.trim() || defaultSaveName('Profile'));
  } else {
    const trimmed = value.trim();
    if (trimmed) onRename(naming.id, trimmed);
  }
  naming = null;
}

// A parse error or a file with no valid entries must not fail silently: the panel parses once,
// says so when nothing was usable, and hands the already-parsed profiles to the importer.
let importError = $state<string | undefined>();
let importStatus = $state<string | undefined>();
let importing = $state(false);

async function importProfiles(): Promise<void> {
  if (importing) return;
  importing = true;
  importStatus = undefined;
  const picked = await pickTextFile('.json,application/json');
  if (!picked.ok) {
    importError = readErrorMessage(picked);
    importing = false;
    return;
  }
  const parsed = parseProfilesJson(picked.text);
  if (parsed.length === 0) {
    importError = 'No valid profiles in that file.';
    importing = false;
    return;
  }
  importError = undefined;
  const imported = onImport(parsed);
  importStatus = `Imported ${imported} ${imported === 1 ? 'profile' : 'profiles'}.`;
  importing = false;
}

// Delete is destructive and propagates to every synced device, so it arms a confirm step rather
// than firing on a single tap, matching the Routes panel.
const armedDelete = new ArmedRow((id) => onRemove(id));
let actionMenuId = $state<string | undefined>();

function useProfile(id: string): void {
  onApply(id);
}
</script>

<SlideOver title="Profiles" bodyFlex closeLabel="Close profiles panel" {onClose} {onBack}>
  {#if syncState === 'capacity-conflict'}
    <p class="alert-note" role="alert">
      The combined device and server libraries exceed the
      {MAX_PROFILES.toLocaleString('en-US')}-profile limit. Delete at least one profile, then retry
      profile sync.
    </p>
    <button type="button" class="btn btn-ghost" onclick={onRetrySync}>Retry profile sync</button>
  {:else if syncState === 'conflict'}
    <p class="alert-note" role="alert">
      Another station changed these profiles. Binnacle could not finish merging the changes.
    </p>
    <button type="button" class="btn btn-ghost" onclick={onRetrySync}>Retry profile sync</button>
  {:else if syncState === 'error'}
    <p class="alert-note" role="alert">
      Profiles are saved on this device. Server profile data could not be read safely.
    </p>
    <button type="button" class="btn btn-ghost" onclick={onRetrySync}>Retry profile sync</button>
  {:else if syncState === 'syncing'}
    <p class="muted-note" role="status">Syncing profiles with this Signal K account…</p>
  {:else if auth.writeBlocked}
    <!-- The app-wide banner offers the same request, but an open panel covers it on a phone, so the
         request stays one tap away from the block it explains. -->
    <WriteAccessNote
      message="Profiles are saved on this device. A write token is needed to sync them to other stations."
      requesting={auth.upgrading}
      onRequest={() => void auth.requestWriteAccess()}
    />
  {:else if syncState === 'synced'}
    <p class="muted-note" role="status">Profiles are synced with this Signal K account.</p>
  {:else if syncState === 'waiting'}
    <p class="muted-note" role="status">
      Profiles are saved on this device. They will sync automatically when the Signal K connection
      is ready.
    </p>
  {:else}
    <p class="muted-note">Profiles are saved on this device.</p>
  {/if}
  <p class="muted-note">
    A profile is a named helm setup. Changes to the active profile save automatically, while each
    device chooses which profile it uses.
  </p>
  {#if remoteUpdateAvailable}
    <div class="alert-note remote-update">
      <p role="status">
        The active profile was updated on another station.
        {#if changeSummary}
          Changed: {changeSummary}.
        {/if}
      </p>
      <p>Apply the shared update, or sync this station's current setup back to the profile.</p>
      <div class="panel-controls">
        <button type="button" class="btn btn-ghost" onclick={onApplyRemoteUpdate}>
          Apply update
        </button>
        <button type="button" class="btn btn-ghost" onclick={onKeepCurrentSetup}>
          Keep current setup
        </button>
      </div>
    </div>
  {/if}
  <div class="panel-controls">
    <button
      type="button"
      class="btn btn-primary btn--grow"
      disabled={atProfileLimit}
      aria-describedby={atProfileLimit ? 'profile-limit-note' : undefined}
      onclick={() => (naming = { mode: 'new' })}
    >
      <Save size={16} aria-hidden="true" />
      Save current as profile
    </button>
    <button
      type="button"
      class="btn"
      title="Import profiles from a file another device exported"
      onclick={importProfiles}
      disabled={importing}
    >
      <Upload size={16} aria-hidden="true" />
      {importing ? 'Importing…' : 'Import'}
    </button>
  </div>
  {#if atProfileLimit}
    <p id="profile-limit-note" class="muted-note" role="status">
      This device holds the {MAX_PROFILES.toLocaleString('en-US')}-profile limit. Delete a profile
      before saving another.
    </p>
  {/if}

  {#if naming?.mode === 'new'}
    <NameEntry
      label="Name this profile"
      value={defaultSaveName('Profile')}
      onConfirm={confirmName}
      onCancel={() => (naming = null)}
    />
  {/if}

  {#if importError}
    <p class="alert-note" role="alert">{importError}</p>
  {:else if importStatus}
    <p class="muted-note" role="status">{importStatus}</p>
  {/if}

  <SavedList
    heading="Saved profiles"
    items={profiles}
    empty="No profiles yet. Configure the helm, then select Save current as profile."
    key={(profile) => profile.id}
    isActive={(profile) => profile.id === activeId}
  >
    {#snippet card(profile)}
      {@const isActive = profile.id === activeId}
      {@const isDefault = profile.id === defaultId}
      <div class="card-head">
        <span class="name">{profile.name}</span>
        {#if isDefault}
          <span class="caps-label tag">Default</span>
        {/if}
        {#if isActive}
          <span class="badge">Active here</span>
        {/if}
      </div>
      {#if naming?.mode === 'rename' && naming.id === profile.id}
        <NameEntry
          label="Rename profile"
          value={profile.name}
          onConfirm={confirmName}
          onCancel={() => (naming = null)}
        />
      {:else if armedDelete.isArmed(profile.id)}
        <InlineConfirm
          question="Delete this profile? If profile sync is available, the deletion will sync to other stations."
          onConfirm={() => armedDelete.confirm(profile.id)}
          onCancel={() => armedDelete.cancel()}
        />
      {:else}
        <div class="actions">
          {#if !isActive}
            <button
              type="button"
              class="icon-btn"
              aria-label={`Use ${profile.name} on this device`}
              title={`Use ${profile.name} on this device`}
              onclick={() => useProfile(profile.id)}
            >
              <Check size={18} aria-hidden="true" />
            </button>
          {/if}
          <OverflowActions
            open={actionMenuId === profile.id}
            label={`More actions for ${profile.name}`}
            onToggle={() => (actionMenuId = actionMenuId === profile.id ? undefined : profile.id)}
            onClose={() => (actionMenuId = undefined)}
          >
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              onclick={() => {
                actionMenuId = undefined;
                naming = { mode: 'rename', id: profile.id };
              }}
            >
              <SquarePen size={18} aria-hidden="true" />
              Rename profile
            </button>
            {#if !isDefault}
              <button
                type="button"
                role="menuitem"
                class="menu-item"
                onclick={() => {
                  actionMenuId = undefined;
                  onSetDefault(profile.id);
                }}
              >
                <Star size={18} aria-hidden="true" />
                Set as default
              </button>
            {/if}
            <button
              type="button"
              role="menuitem"
              class="menu-item"
              onclick={() => {
                actionMenuId = undefined;
                onExport(profile.id);
              }}
            >
              <Download size={18} aria-hidden="true" />
              Export profile
            </button>
            <button
              type="button"
              role="menuitem"
              class="menu-item sev-danger"
              onclick={() => {
                actionMenuId = undefined;
                armedDelete.arm(profile.id);
              }}
            >
              <Trash2 size={18} aria-hidden="true" />
              Delete profile
            </button>
          </OverflowActions>
        </div>
      {/if}
    {/snippet}
  </SavedList>
  <section class="panel-section" aria-label="Units">
    <h3 class="caps-label">Units</h3>
    {#if units.source === 'server'}
      <!-- The server preference always wins; a competing local toggle here would let this panel
           disagree with the admin UI and every other webapp on the boat. -->
      <p class="muted-note">
        Following the Signal K server's unit preference ({units.mode}). Change it in the server's
        admin settings; Binnacle never overrides it.
      </p>
    {:else}
      <p class="muted-note">
        This server does not publish a unit preference, so displays use this device's fallback,
        which profiles carry. The server preference takes over automatically when one appears.
      </p>
      <div class="segmented" role="group" aria-label="Fallback display units">
        {#each UNIT_MODES as mode (mode)}
          <button
            type="button"
            class="btn"
            class:is-on={units.localSetting.value === mode}
            aria-pressed={units.localSetting.value === mode}
            onclick={() => units.localSetting.set(mode)}
          >
            {mode === 'metric' ? 'Metric' : 'Imperial'}
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <DevicePrivacySection {onForgetCredentials} {onEraseAllLocalData} />
</SlideOver>

<style>
/* The card list, name, actions, the active-card accent treatment, and the "Active" badge all come from
   the shared .saved system in app.css. */
/* A quiet caps-label tag marking the default profile, distinct from the filled accent "Active" pill. */
.tag {
  flex-shrink: 0;
  color: var(--accent);
}
.remote-update {
  display: grid;
  gap: var(--space-2);
}
.remote-update p {
  margin: 0;
}
/* The import error uses the global .alert-note rule; the armed delete confirm comes from the
   shared InlineConfirm component. */
</style>

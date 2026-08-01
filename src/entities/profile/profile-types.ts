import type { UnitsMode } from '$shared/lib';
import type { LayerSettings } from '$shared/map';
import type { Thresholds, TrackSettings } from '$shared/settings';
import type { Theme } from '$shared/ui';

// The portable preferences a named profile owns. Device chrome, active safety state, credentials,
// caches, and server resources deliberately stay outside this bundle.
export interface ProfileSettings {
  theme: Theme;
  layers: LayerSettings;
  layerOrder: string[];
  weatherLayers: LayerSettings;
  thresholds: Thresholds;
  trackSettings: TrackSettings;
  // Route planning speed in m/s. SI like every other persisted measure; the route plan converts to
  // knots at its field.
  planningSpeedMps: number;
  // Legacy: the same setting in knots, as profiles saved before the SI migration carry it. Accepted
  // on read so an older document still validates; sanitizeProfileSettings converts it and drops it,
  // so a profile this build writes never carries it.
  planningSpeedKn?: number;
  // The LOCAL units fallback only; optional so profiles saved before it existed stay valid. When the
  // server's unit preferences resolve, they win and this field is inert.
  units?: UnitsMode;
  // The ids of the actions pinned to the bottom bar, in stored (pin) order. Optional so profiles
  // saved before this field stay valid; the default applies at the read edge when absent.
  pinnedActionIds?: string[];
  // Selected instrument tiles in display order; optional for pre-instruments profiles.
  instrumentTiles?: string[];
  // Selected Data trends instruments in display order. Optional for profiles saved before
  // customizable trends existed; the read edge applies the original four-chart default.
  trendInstrumentIds?: string[];
  // The starting radius for the next anchor drop, in meters. The active watch and its live radius are
  // safety state and never travel with a profile.
  anchorRadiusMeters?: number;
  // Legacy device and safety fields remain optional so older exports validate and round-trip, but the
  // current bindings never capture or apply them.
  layerCategories?: Record<string, boolean>;
  arrivalMuted?: boolean;
  // Reserved for the future three-mode shell. Older clients must preserve it during field updates.
  mode?: string;
}

export const PORTABLE_PROFILE_SETTING_KEYS = [
  'theme',
  'layers',
  'layerOrder',
  'weatherLayers',
  'thresholds',
  'trackSettings',
  'planningSpeedMps',
  'units',
  'pinnedActionIds',
  'instrumentTiles',
  'trendInstrumentIds',
  'anchorRadiusMeters',
] as const satisfies readonly (keyof ProfileSettings)[];

export type PortableProfileSettingKey = (typeof PORTABLE_PROFILE_SETTING_KEYS)[number];

export interface Profile {
  id: string;
  name: string;
  settings: ProfileSettings;
  createdAt: number;
  updatedAt: number;
  // Field clocks let two stations merge changes to different settings without replacing the whole
  // profile. They are synchronization metadata, not user-facing time claims.
  settingUpdatedAt?: Record<string, number>;
  nameUpdatedAt?: number;
}

export interface ProfileTombstone {
  id: string;
  deletedAt: number;
}

export interface PendingProfileChange {
  full?: boolean;
  settings?: Partial<Record<PortableProfileSettingKey, number>>;
  nameUpdatedAt?: number;
  deletedAt?: number;
}

export interface ProfilePendingJournal {
  profiles: Record<string, PendingProfileChange>;
  defaultId?: string | null;
}

export interface ProfilesState {
  schemaVersion?: 2;
  profiles: Profile[];
  activeId: string | undefined;
  defaultId: string | undefined;
  // The settings actually applied to the active browser. This can intentionally lag the cached
  // server profile until the navigator accepts a remote update.
  applied?: {
    profileId: string;
    settings: ProfileSettings;
  };
  tombstones?: ProfileTombstone[];
  pending?: ProfilePendingJournal;
}

export interface RemoteProfilesSnapshot {
  profiles: Profile[];
  defaultId: string | undefined;
  tombstones: ProfileTombstone[];
  revision: number;
}

export interface ProfileServerMutation {
  profiles: Array<
    | { type: 'put'; profile: Profile }
    | {
        type: 'patch';
        id: string;
        settings: Partial<Pick<ProfileSettings, PortableProfileSettingKey>>;
        settingUpdatedAt: Record<string, number>;
        updatedAt: number;
      }
    | { type: 'rename'; id: string; name: string; nameUpdatedAt: number; updatedAt: number }
    | { type: 'delete'; tombstone: ProfileTombstone }
  >;
  defaultId?: string | null;
}

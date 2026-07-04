import type { UnitsMode } from '$shared/lib';
import type { LayerSettings } from '$shared/map';
import type { Thresholds, TrackSettings } from '$shared/settings';
import type { Theme } from '$shared/ui';

// The full set of user preferences a profile captures, so switching profiles restores a complete
// look and policy in one step. `mode` is reserved for the future three-mode shell (Watch, Anchor,
// Inhabit): v1 never writes it, but it round-trips so a v3 profile read by v1 keeps its value.
export interface ProfileSettings {
  theme: Theme;
  layers: LayerSettings;
  layerOrder: string[];
  layerCategories: Record<string, boolean>;
  weatherLayers: LayerSettings;
  thresholds: Thresholds;
  trackSettings: TrackSettings;
  planningSpeedKn: number;
  // The collision-alarm mute is deliberately NOT a profile field: it is a session-only, auto-expiring
  // safety state (see CollisionMute), never persisted or carried across a profile switch. Arrival mute
  // is a benign convenience preference, so it stays.
  arrivalMuted: boolean;
  // The LOCAL units fallback only; optional so profiles saved before it existed stay valid. When the
  // server's unit preferences resolve, they win and this field is inert.
  units?: UnitsMode;
  // The ids of the actions pinned to the bottom bar, in stored (pin) order. Optional so profiles
  // saved before this field stay valid; the default applies at the read edge when absent.
  pinnedActionIds?: string[];
  // Selected instrument tiles in display order; optional for pre-instruments profiles.
  instrumentTiles?: string[];
  mode?: string;
}

export interface Profile {
  id: string;
  name: string;
  settings: ProfileSettings;
  createdAt: number;
  updatedAt: number;
}

export interface ProfilesState {
  profiles: Profile[];
  activeId: string | undefined;
  defaultId: string | undefined;
}

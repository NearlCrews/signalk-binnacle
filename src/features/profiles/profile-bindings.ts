import { DEFAULT_TREND_INSTRUMENT_IDS } from '$entities/instrument-trend';
import type { ProfileSettings } from '$entities/profile';
import type { UnitsMode } from '$shared/lib';
import type { LayerSettings } from '$shared/map';
import type {
  ChartOrientationMode,
  PersistedValue,
  Thresholds,
  TrackSettings,
} from '$shared/settings';
import type { ThemeController } from '$shared/ui';

// Every store a profile captures. All are shared-layer services or entity types, so this binding
// table lives in the profiles feature without reaching across to another feature or up to a widget;
// the composition root just hands the constructed services in.
export interface ProfileBindingDeps {
  theme: ThemeController;
  layers: PersistedValue<LayerSettings>;
  layerOrder: PersistedValue<string[]>;
  weatherLayers: PersistedValue<LayerSettings>;
  thresholds: PersistedValue<Thresholds>;
  trackSettings: PersistedValue<TrackSettings>;
  planningSpeedMps: PersistedValue<number>;
  // The local units fallback (the server preference, when resolved, wins outside profiles).
  unitsLocal: PersistedValue<UnitsMode>;
  // The bottom-bar pinned action ids.
  pinnedActions: PersistedValue<string[]>;
  // The instrument tile selection, in display order.
  instrumentTiles: PersistedValue<string[]>;
  // The Data trends selection, in display order.
  trendInstruments: PersistedValue<string[]>;
  // The next anchor drop's preferred radius. This seam deliberately cannot expose or alter the
  // active anchor watch.
  anchorRadius: {
    get(): number;
    set(radiusMeters: number): void;
  };
  // The chart orientation mode (north-up, course-up, heading-up).
  chartOrientation: PersistedValue<ChartOrientationMode>;
  // The display cluster, bound through the controller's clamping setters so a corrupt profile
  // value cannot escape the bounds. Structural on purpose: the display slice is a feature, and a
  // sibling feature may not import its types.
  display: {
    readonly dim: number;
    setDim(value: number): void;
    readonly autoTheme: boolean;
    setAutoTheme(on: boolean): void;
    readonly textScale: number;
    setTextScale(value: number): void;
    readonly sunMode: boolean;
    setSunMode(on: boolean): void;
  };
}

export interface ProfileBindings {
  // Read every portable store into a profile bundle.
  capture(): ProfileSettings;
  // Write every portable store from a bundle. The live map-layer push stays in the composition root,
  // which owns the map handles.
  apply(settings: ProfileSettings): void;
  // Read every portable store, so the controller's reactive observer re-runs when any of them change.
  track(): void;
}

// Defines every portable setting once: how to read it into a profile bundle, how to write it back, and
// how to track it for autosave. Adding a setting is one entry here, not a parallel edit to a capture
// list, an apply list, and an autosave list that could drift out of step. The layers and
// order read the persisted overrides, not the live LayerManager state, which keeps capture cheap and
// matches what a restore writes back.
export function createProfileBindings(deps: ProfileBindingDeps): ProfileBindings {
  // The satisfies clause keys the table by every portable ProfileSettings field (mode is reserved and
  // inert, so it is excluded), so forgetting a setting is a build error here rather than a silently
  // incomplete capture. Each read returns just its own slice for the assembled bundle.
  const table = {
    theme: {
      read: () => ({ theme: deps.theme.theme }),
      write: (s) => deps.theme.set(s.theme),
      track: () => void deps.theme.theme,
    },
    layers: {
      read: () => ({ layers: deps.layers.snapshot() }),
      write: (s) => deps.layers.set(s.layers),
      track: () => void deps.layers.value,
    },
    layerOrder: {
      read: () => ({ layerOrder: deps.layerOrder.snapshot() }),
      write: (s) => deps.layerOrder.set(s.layerOrder),
      track: () => void deps.layerOrder.value,
    },
    weatherLayers: {
      read: () => ({ weatherLayers: deps.weatherLayers.snapshot() }),
      write: (s) => deps.weatherLayers.set(s.weatherLayers),
      track: () => void deps.weatherLayers.value,
    },
    thresholds: {
      read: () => ({ thresholds: deps.thresholds.snapshot() }),
      write: (s) => deps.thresholds.set(s.thresholds),
      track: () => void deps.thresholds.value,
    },
    trackSettings: {
      read: () => ({ trackSettings: deps.trackSettings.snapshot() }),
      write: (s) => deps.trackSettings.set(s.trackSettings),
      track: () => void deps.trackSettings.value,
    },
    planningSpeedMps: {
      read: () => ({ planningSpeedMps: deps.planningSpeedMps.snapshot() }),
      write: (s) => deps.planningSpeedMps.set(s.planningSpeedMps),
      track: () => void deps.planningSpeedMps.value,
    },
    pinnedActionIds: {
      read: () => ({ pinnedActionIds: deps.pinnedActions.snapshot() }),
      // Array-guarded, not truthy-guarded: an intentionally empty array (a cleared bar) must apply,
      // and a non-array from a corrupt or cross-version document must be ignored.
      write: (s) => {
        if (Array.isArray(s.pinnedActionIds)) deps.pinnedActions.set(s.pinnedActionIds);
      },
      track: () => void deps.pinnedActions.value,
    },
    instrumentTiles: {
      read: () => ({ instrumentTiles: deps.instrumentTiles.snapshot() }),
      write: (s) => {
        if (Array.isArray(s.instrumentTiles)) deps.instrumentTiles.set(s.instrumentTiles);
      },
      track: () => void deps.instrumentTiles.value,
    },
    trendInstrumentIds: {
      read: () => ({ trendInstrumentIds: deps.trendInstruments.snapshot() }),
      // A legacy profile must resolve to its own default. Leaving the current PersistedValue alone
      // would make it inherit whichever profile happened to be active immediately before it.
      write: (s) =>
        deps.trendInstruments.set(
          Array.isArray(s.trendInstrumentIds)
            ? s.trendInstrumentIds
            : [...DEFAULT_TREND_INSTRUMENT_IDS],
        ),
      track: () => void deps.trendInstruments.value,
    },
    anchorRadiusMeters: {
      read: () => ({ anchorRadiusMeters: deps.anchorRadius.get() }),
      write: (s) => {
        if (s.anchorRadiusMeters !== undefined) deps.anchorRadius.set(s.anchorRadiusMeters);
      },
      track: () => void deps.anchorRadius.get(),
    },
    chartOrientation: {
      read: () => ({ chartOrientation: deps.chartOrientation.snapshot() }),
      // Optional for compatibility: a profile saved before orientation existed reads as north-up
      // rather than inheriting the previously active profile's rotation.
      write: (s) => deps.chartOrientation.set(s.chartOrientation ?? 'north'),
      track: () => void deps.chartOrientation.value,
    },
    displayDim: {
      read: () => ({ displayDim: deps.display.dim }),
      // A legacy profile resets to undimmed rather than inheriting the prior profile's dim.
      write: (s) => deps.display.setDim(s.displayDim ?? 0),
      track: () => void deps.display.dim,
    },
    displayAutoTheme: {
      read: () => ({ displayAutoTheme: deps.display.autoTheme }),
      write: (s) => deps.display.setAutoTheme(s.displayAutoTheme ?? false),
      track: () => void deps.display.autoTheme,
    },
    displayTextScale: {
      read: () => ({ displayTextScale: deps.display.textScale }),
      // Snapped to the setting's 10-percent steps so an off-step value from an older or foreign
      // document still applies instead of silently leaving the prior profile's scale in place.
      write: (s) => {
        const scale = Math.round((s.displayTextScale ?? 100) / 10) * 10;
        deps.display.setTextScale(Math.min(130, Math.max(100, scale)));
      },
      track: () => void deps.display.textScale,
    },
    displaySunMode: {
      read: () => ({ displaySunMode: deps.display.sunMode }),
      write: (s) => deps.display.setSunMode(s.displaySunMode ?? false),
      track: () => void deps.display.sunMode,
    },
    units: {
      read: () => ({ units: deps.unitsLocal.snapshot() }),
      // Optional for compatibility: a profile saved before the field existed leaves units alone.
      write: (s) => {
        if (s.units) deps.unitsLocal.set(s.units);
      },
      track: () => void deps.unitsLocal.value,
    },
  } satisfies {
    [K in keyof Omit<ProfileSettings, 'mode' | 'layerCategories' | 'arrivalMuted'>]: {
      read: () => Pick<ProfileSettings, K>;
      write: (s: ProfileSettings) => void;
      track: () => void;
    };
  };

  const bindings = Object.values(table);
  return {
    // satisfies above proves all fields are present; the cast is safe.
    capture: () => Object.assign({}, ...bindings.map((p) => p.read())) as ProfileSettings,
    apply: (settings) => {
      for (const p of bindings) p.write(settings);
    },
    track: () => {
      for (const p of bindings) p.track();
    },
  };
}

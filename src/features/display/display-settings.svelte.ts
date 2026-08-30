import { untrack } from 'svelte';
import type { LatLon } from '$shared/geo';
import { clamp, type ReactiveClock } from '$shared/lib';
import { isAfterDark } from '$shared/nav';
import { binnacleStorageKey } from '$shared/persistence';
import {
  booleanPersistedCodec,
  boundedNumberPersistedCodec,
  createPersistedCodec,
  PersistedValue,
  type StorageLike,
} from '$shared/settings';
import type { Theme } from '$shared/ui';

// The dim ceiling is the alarm floor: the overlay may never take more than 85 percent of the
// screen's luminance, so the chart, the safety strips, and a sounding alarm stay readable behind a
// pointer-transparent layer that has no tap-to-clear affordance of its own.
export const MAX_DISPLAY_DIM = 0.85;

export const TEXT_SCALES = [100, 110, 120, 130] as const;
export type TextScale = (typeof TEXT_SCALES)[number];
const DEFAULT_TEXT_SCALE: TextScale = 100;

const textScaleCodec = createPersistedCodec(
  (value: unknown): value is TextScale =>
    typeof value === 'number' && (TEXT_SCALES as readonly number[]).includes(value),
);

// The document-root seam the text scale writes to, structural so tests pass a plain object.
export interface TextScaleRoot {
  style: { fontSize: string };
}

export interface DisplaySettingsDeps {
  // Reactive getters, never captured values: the self vessel's environment.mode cell value, the
  // current fix for the solar fallback, and the live theme.
  getEnvironmentMode: () => unknown;
  getPosition: () => LatLon | undefined;
  clock: ReactiveClock;
  getTheme: () => Theme;
  // The existing ThemeController's set, so automatic changes flow through the one theme authority.
  setTheme: (theme: Theme) => void;
  storage?: StorageLike;
  // Defaults to document.documentElement; injected for tests.
  textScaleRoot?: TextScaleRoot;
}

export interface DisplaySettingsController {
  // The dim layer's opacity, 0 (off) to MAX_DISPLAY_DIM.
  readonly dim: number;
  setDim(value: number): void;
  readonly autoTheme: boolean;
  setAutoTheme(on: boolean): void;
  // True while a manual theme choice holds automatic switching until the next day-night change.
  readonly autoThemeSuspended: boolean;
  // What auto would show right now, or undefined with auto off or no day-night signal at all.
  readonly recommendedTheme: Theme | undefined;
  readonly textScale: TextScale;
  setTextScale(value: number): void;
  // The bright-sun chart palette: day-scoped high-contrast map paint for direct sunlight. The map
  // recolor reads it; it never changes the app chrome or the dark themes.
  readonly sunMode: boolean;
  setSunMode(on: boolean): void;
  // The offer-and-confirm sunset prompt, raised once per dark edge while auto theme is off and
  // the day theme shows. Accepting switches to night-red; dismissing waits for the next evening.
  readonly sunsetOffer: boolean;
  acceptSunsetOffer(): void;
  dismissSunsetOffer(): void;
  // The persisted values themselves, for the profile binding table.
  readonly dimSetting: PersistedValue<number>;
  readonly autoThemeSetting: PersistedValue<boolean>;
  readonly textScaleSetting: PersistedValue<TextScale>;
}

// Owns the three profile-scoped display settings: the true-black dim layer's opacity, the opt-in
// automatic day and night theme, and the interface text scale. Construct it where effects attach
// (the composition root); it applies the text scale to the document root and drives the theme
// through the injected ThemeController itself.
export function createDisplaySettingsController(
  deps: DisplaySettingsDeps,
): DisplaySettingsController {
  const dim = new PersistedValue(
    binnacleStorageKey('displayDim'),
    0,
    deps.storage,
    boundedNumberPersistedCodec(0, MAX_DISPLAY_DIM),
  );
  const autoTheme = new PersistedValue(
    binnacleStorageKey('displayAutoTheme'),
    false,
    deps.storage,
    booleanPersistedCodec,
  );
  const textScale = new PersistedValue<TextScale>(
    binnacleStorageKey('displayTextScale'),
    DEFAULT_TEXT_SCALE,
    deps.storage,
    textScaleCodec,
  );
  const sunMode = new PersistedValue(
    binnacleStorageKey('displaySunMode'),
    false,
    deps.storage,
    booleanPersistedCodec,
  );

  const textScaleRoot =
    deps.textScaleRoot ?? (typeof document !== 'undefined' ? document.documentElement : undefined);

  $effect(() => {
    if (textScaleRoot === undefined) return;
    const scale = textScale.value;
    // 100 restores the stylesheet default instead of pinning font-size, so the browser's own
    // text-size setting keeps working untouched.
    textScaleRoot.style.fontSize = scale === DEFAULT_TEXT_SCALE ? '' : `${scale}%`;
    return () => {
      textScaleRoot.style.fontSize = '';
    };
  });

  // Whether it is dark right now. The server's declared environment.mode wins; without one, the
  // sun's position at the vessel's fix decides; with neither, undefined keeps both the auto theme
  // and the sunset offer silent.
  const darkNow = $derived.by<boolean | undefined>(() => {
    const mode = deps.getEnvironmentMode();
    if (mode === 'night') return true;
    if (mode === 'day') return false;
    const position = deps.getPosition();
    if (position === undefined) return undefined;
    return isAfterDark(deps.clock.now, position.latitude, position.longitude);
  });

  // What auto would show right now. Auto is two-state on purpose: dusk is a manual taste, and
  // flashing dark-adapted eyes through dusk's brighter palette on the way to night-red is exactly
  // what the direct jump avoids.
  const recommendation = $derived.by<Theme | undefined>(() => {
    if (!autoTheme.value || darkNow === undefined) return undefined;
    return darkNow ? 'night-red' : 'day';
  });

  // The sunset offer: with auto theme off, crossing into dark while the day theme shows raises a
  // one-shot offer to switch. Offer-and-confirm only, once per dark edge; daylight clears it, so
  // every sunset gets exactly one ask and a dismissal holds until the next evening.
  let sunsetOfferOpen = $state(false);
  let wasDark: boolean | undefined;
  $effect(() => {
    const dark = darkNow;
    if (dark === undefined) return;
    const crossedIntoDark = dark && wasDark === false;
    wasDark = dark;
    if (!dark) {
      if (untrack(() => sunsetOfferOpen)) sunsetOfferOpen = false;
      return;
    }
    if (!crossedIntoDark || autoTheme.value) return;
    if (deps.getTheme() !== 'day') return;
    sunsetOfferOpen = true;
  });

  let suspended = $state(false);
  // Edge memory for the sync effect, not UI state: the recommendation the last pass saw.
  let lastRecommendation: Theme | undefined;

  $effect(() => {
    const next = recommendation;
    const current = deps.getTheme();
    if (next === undefined) {
      lastRecommendation = undefined;
      if (untrack(() => suspended)) suspended = false;
      return;
    }
    if (next !== lastRecommendation) {
      // A day-night boundary, auto just enabled, or the signal source changed: the edge lifts a
      // manual hold and drives the theme.
      lastRecommendation = next;
      if (untrack(() => suspended)) suspended = false;
      if (current !== next) deps.setTheme(next);
      return;
    }
    // Same recommendation but the theme moved: a manual choice. Hold auto until the next edge
    // instead of fighting the navigator's hand.
    if (current !== next && !untrack(() => suspended)) suspended = true;
  });

  return {
    get dim(): number {
      return dim.value;
    },
    setDim(value: number): void {
      if (!Number.isFinite(value)) return;
      dim.set(clamp(value, 0, MAX_DISPLAY_DIM));
    },
    get autoTheme(): boolean {
      return autoTheme.value;
    },
    setAutoTheme(on: boolean): void {
      autoTheme.set(on);
    },
    get autoThemeSuspended(): boolean {
      return suspended;
    },
    get recommendedTheme(): Theme | undefined {
      return recommendation;
    },
    get textScale(): TextScale {
      return textScale.value;
    },
    setTextScale(value: number): void {
      if ((TEXT_SCALES as readonly number[]).includes(value)) textScale.set(value as TextScale);
    },
    get sunMode(): boolean {
      return sunMode.value;
    },
    setSunMode(on: boolean): void {
      sunMode.set(on);
    },
    get sunsetOffer(): boolean {
      return sunsetOfferOpen;
    },
    acceptSunsetOffer(): void {
      if (!sunsetOfferOpen) return;
      sunsetOfferOpen = false;
      deps.setTheme('night-red');
    },
    dismissSunsetOffer(): void {
      sunsetOfferOpen = false;
    },
    dimSetting: dim,
    autoThemeSetting: autoTheme,
    textScaleSetting: textScale,
  };
}

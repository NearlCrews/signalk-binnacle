import { binnacleStorageKey } from '$shared/persistence';

export const THEMES = ['day', 'dusk', 'night-red'] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = binnacleStorageKey('theme');
const THEME_COLORS: Record<Theme, string> = {
  day: '#cfe0ec',
  dusk: '#0f1a24',
  'night-red': '#000000',
};

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export class ThemeController {
  theme = $state<Theme>('day');

  #apply: (theme: Theme) => void;
  #persist: (theme: Theme) => void;

  constructor(
    initial: string | null,
    apply: (theme: Theme) => void,
    persist: (theme: Theme) => void = () => {},
  ) {
    this.#apply = apply;
    this.#persist = persist;
    if (isTheme(initial)) this.theme = initial;
    this.#apply(this.theme);
  }

  set(theme: Theme): void {
    this.theme = theme;
    this.#apply(theme);
    this.#persist(theme);
  }

  cycle(): void {
    const next = THEMES[(THEMES.indexOf(this.theme) + 1) % THEMES.length];
    this.set(next);
  }
}

// Wires a ThemeController to the document and localStorage for app use.
export function createThemeController(onApply?: (theme: Theme) => void): ThemeController {
  return new ThemeController(
    readStoredTheme(),
    (theme) => {
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.theme = theme;
        document
          .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
          ?.setAttribute('content', THEME_COLORS[theme]);
      }
      onApply?.(theme);
    },
    writeStoredTheme,
  );
}

// localStorage can be absent (SSR) or throw (private mode, quota); guard both so a read or a
// failed persist never breaks theming. The stored value is a bare theme string, not JSON.
function readStoredTheme(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode or quota: keep the in-memory theme, skip persistence.
  }
}

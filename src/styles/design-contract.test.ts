import { describe, expect, it } from 'vitest';
import { LANDSCAPE_SHORT_QUERY } from '$shared/lib';

// Every stylesheet and component as text. A design rule that drifted twice is guarded here rather
// than reviewed again: each assertion names the rule it holds.
const sources = import.meta.glob<string>(['/src/**/*.{css,svelte,ts}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const tokens = sources['/src/styles/tokens.css'] ?? '';
const forms = sources['/src/styles/forms.css'] ?? '';

function nonTestSources(): [string, string][] {
  return Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts'));
}

function hits(pattern: RegExp): string[] {
  return nonTestSources()
    .filter(([, text]) => pattern.test(text))
    .map(([path]) => path);
}

describe('design contract: form controls', () => {
  it('defines a control boundary in every theme', () => {
    expect(tokens).toMatch(/:root \{[\s\S]*?--border-control:/);
    expect(tokens).toMatch(/\[data-theme="dusk"\] \{[\s\S]*?--border-control:/);
    expect(tokens).toMatch(/\[data-theme="night-red"\] \{[\s\S]*?--border-control:/);
  });

  it('draws checkboxes and radios instead of tinting the browser control', () => {
    expect(forms).not.toContain('accent-color');
    expect(forms).toMatch(
      /input\[type="checkbox"\],\s*input\[type="radio"\] \{[\s\S]*?appearance: none/,
    );
    expect(forms).toMatch(/@media \(forced-colors: active\) \{[\s\S]*?appearance: auto/);
  });

  it('lets no component restore the native control look', () => {
    // forms.css owns the one sanctioned fallback, the forced-colors block.
    const restored = hits(/input\[type="(checkbox|radio)"\][^{]*\{[^}]*appearance:\s*auto/);
    expect(restored.filter((path) => path !== '/src/styles/forms.css')).toEqual([]);
  });
});

describe('design contract: corners', () => {
  it('uses three radii: md for panel controls, lg for dialogs, and pill for chrome', () => {
    expect(hits(/--radius-sm/)).toEqual([]);
  });
});

describe('design contract: one button system', () => {
  it('has no parallel strip button class', () => {
    expect(hits(/class="[^"]*\back(--[a-z]+)?\b(?!-)/)).toEqual([]);
    expect(hits(/\.ack(--[a-z]+)?(?![\w-])/)).toEqual([]);
  });

  it('lets warning, danger, and alarm colors win over the strip action accent', () => {
    const buttons = sources['/src/styles/buttons.css'] ?? '';
    const strip = buttons.indexOf('.btn-strip {');
    expect(strip).toBeGreaterThan(-1);
    expect(strip).toBeLessThan(buttons.indexOf('.btn-danger {'));
    expect(strip).toBeLessThan(buttons.indexOf('.btn-warning {'));
    expect(buttons.indexOf('.btn-alarm {')).toBeGreaterThan(buttons.indexOf('.btn-warning {'));
  });

  it('never dims an acknowledged alarm with opacity', () => {
    expect(hits(/(is-ack|acked)[^{]*\{[^}]*opacity/)).toEqual([]);
    expect(sources['/src/styles/strips.css']).toMatch(
      /\.bottom-strip\.is-ack \{[^}]*border-style: dashed/,
    );
  });
});

describe('design contract: one badge', () => {
  it('draws status pills from the shared badge module only', () => {
    expect(hits(/\.(tile-state|state-tag)(--[a-z]+)?\s*\{/)).toEqual([]);
    expect(hits(/\.saved \.badge\s*\{/)).toEqual([]);
    const scopedBadge = Object.entries(sources).filter(
      ([path, text]) => path.endsWith('.svelte') && /<style>[\s\S]*\n\.badge[\s[{]/.test(text),
    );
    expect(scopedBadge.map(([path]) => path)).toEqual([]);
  });
});

// Product source only: test files quote user strings in their own words, and a test harness is a
// fixture, not product copy.
const product = Object.entries(sources).filter(
  ([path]) => !/\.test\.ts$|TestHarness\.svelte$/.test(path),
);

describe('design contract: load and retry copy', () => {
  it('ends every loading string with an ellipsis', () => {
    const offenders = product.flatMap(([path, text]) =>
      [...text.matchAll(/(?:>|'|"|`)(Loading [^<'"`…]+?)(?:<|'|"|`)/g)]
        .filter(
          (match) =>
            !/aria-label=$/.test(text.slice(Math.max(0, (match.index ?? 0) - 11), match.index)),
        )
        .map((match) => match[1] ?? '')
        .filter((phrase) => !/[.…]$/.test(phrase))
        .map((phrase) => `${path}: ${phrase}`),
    );
    expect(offenders).toEqual([]);
  });

  it('labels every retry button Retry or Check again', () => {
    const offenders = product.flatMap(([path, text]) =>
      [...text.matchAll(/>\s*(Retry[^<{]*?)\s*</g)]
        .map((match) => match[1] ?? '')
        .filter((label) => label !== 'Retry')
        .map((label) => `${path}: ${label}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('design contract: state colors hold through every interaction', () => {
  const buttons = sources['/src/styles/buttons.css'] ?? '';
  const badges = sources['/src/styles/badges.css'] ?? '';

  it('keeps a destructive strip action apart by its alarm border at rest', () => {
    expect(buttons).toMatch(/\.btn-strip\.btn-danger \{[^}]*border-color: var\(--alarm\)/);
  });

  it('keeps a warning button amber on hover instead of taking the accent border', () => {
    expect(buttons).toMatch(
      /\.btn-warning:hover:not\(:disabled\) \{[^}]*border-color: var\(--warning\)/,
    );
  });

  it('keeps the lowest raised alarm grade bordered in its full text color', () => {
    expect(badges).toMatch(/\.badge--strong \{[^}]*border-color: currentColor/);
  });
});

describe('design contract: one visually-hidden rule', () => {
  it('hides text from view only through the shared a11y class', () => {
    const copies = hits(/clip-path:\s*inset\(50%\)/);
    expect(copies.filter((path) => path !== '/src/styles/a11y.css')).toEqual([]);
  });

  it('keeps the top bar aligned with the installed app title bar', () => {
    const app = sources['/src/app/App.svelte'] ?? '';
    // The unindented rule is the base one; the phone block nests its own .topbar rule.
    const base = app.match(/\n\.topbar \{([^}]*)\}/)?.[1] ?? '';
    expect(base).toContain('padding-block-start: max(var(--space-1), env(titlebar-area-y, 0px));');
    expect(base).toContain(
      'min-block-size: max(var(--control-size), env(titlebar-area-height, 0px));',
    );
  });
});

describe('design contract: reading rhythm', () => {
  const text = sources['/src/styles/text.css'] ?? '';

  it('keeps the smallest text at 12px or larger in every theme', () => {
    const sizes = [...tokens.matchAll(/--text-xs:\s*([\d.]+)rem/g)].map((match) =>
      Number(match[1]),
    );
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(0.75);
  });

  it('gives running text the prose line spacing and avoids orphaned last words', () => {
    expect(tokens).toMatch(/:root \{[^}]*?--leading-prose: 1\.4;/);
    expect(text).toMatch(
      /p,\s*\.muted-note,\s*\.alert-note \{[^}]*line-height: var\(--leading-prose\);[^}]*text-wrap: pretty;/,
    );
  });

  it('balances panel, dialog, and empty-state titles', () => {
    expect(text).toMatch(
      /\.panel-title,\s*\.dialog-header h2,\s*\.empty-state-title \{[^}]*text-wrap: balance;/,
    );
  });
});

describe('design contract: alarm strips', () => {
  const strips = sources['/src/styles/strips.css'] ?? '';

  it('draws alarm and warning strips with a 2px border and a light grade wash', () => {
    expect(strips).toMatch(
      /\n\.bottom-strip \{[^}]*background: var\(--strip-fill, var\(--surface-overlay\)\);/,
    );
    expect(strips).toMatch(
      /\.bottom-strip--alarm,\s*\.bottom-strip--warning \{[^}]*border-width: 2px;[^}]*--strip-fill: color-mix\(in srgb, var\(--strip-accent\) 10%, var\(--surface-overlay\)\);/,
    );
  });

  it('keeps night-red strips on the overlay surface so body text holds AA', () => {
    expect(strips).toMatch(
      /:root\[data-theme="night-red"\] \.bottom-strip \{[^}]*--strip-fill: var\(--surface-overlay\);/,
    );
  });

  it('sizes every alarm strip title alike, with no scoped copy', () => {
    expect(strips).toMatch(
      /\.bottom-strip--alarm \.title,\s*\.bottom-strip--warning \.title \{[^}]*font-size: var\(--text-base\);[^}]*font-weight: 700;/,
    );
    expect(sources['/src/features/lookout/DangerStrip.svelte'] ?? '').not.toMatch(/\n\.title \{/);
  });

  it('drops the wash once acknowledged', () => {
    expect(strips).toMatch(
      /\.bottom-strip\.is-ack \{[^}]*border-style: dashed;[^}]*--strip-fill: var\(--surface-overlay\);/,
    );
  });
});

describe('design contract: helm readouts', () => {
  const strip = sources['/src/app/StatusStrip.svelte'] ?? '';
  const cells = sources['/src/styles/data-cells.css'] ?? '';
  const pinned = sources['/src/features/menu/PinnedActions.svelte'] ?? '';

  it('sets every bar value at one size on one shared baseline', () => {
    expect(cells).toMatch(/\.data-cell-value \.num \{\s*font-size: var\(--text-data\);/);
    // The numeral strut that puts a word value, and a tile's label, on the numerals' baseline.
    expect(cells).toMatch(
      /\.data-baseline::before,\s*\.data-cell-value::before \{[^}]*font-family: var\(--font-mono\);[^}]*font-size: var\(--text-data\);/,
    );
    expect(pinned).toContain('class="tile-label data-baseline"');
    // No component sizes a bar value on its own.
    expect(strip).not.toMatch(/\.num \{[^}]*font-size/);
    expect(strip).not.toContain('--text-readout');
  });

  it('derives the helm row from fourteen bar columns and the two gutters', () => {
    const rem = (pattern: RegExp, text: string): number => {
      const match = text.match(pattern);
      if (!match?.[1]) throw new Error(`No ${pattern}`);
      return Number.parseFloat(match[1]);
    };
    const column = rem(/--data-cell-min: ([\d.]+)rem;/, tokens);
    const gutter = rem(/\.status-strip \{[^}]*--strip-gutter: ([\d.]+)rem;/, strip);
    const row = rem(
      /@container status-strip \(min-width: ([\d.]+)rem\) \{\s*\.strip-grid \{\s*grid-template-columns: var\(--strip-gutter\) repeat\(14, minmax\(0, 1fr\)\) var\(--strip-gutter\);/,
      strip,
    );
    expect(row).toBeCloseTo(14 * column + 2 * gutter, 5);
  });

  it('marks stale numerals by shape in every theme, not by color alone', () => {
    const text = sources['/src/styles/text.css'] ?? '';
    expect(text).toMatch(/\.stale-cue \.num \{[^}]*text-decoration: underline dashed;/);
    for (const tile of ['NumericTile', 'WindTile'])
      expect(sources[`/src/features/instruments/${tile}.svelte`] ?? '').toContain(
        "class:stale-cue={reading.state === 'stale'}",
      );
    // The motion readouts share one snippet; it and the depth cell both carry the cue.
    expect(strip).toMatch(/\{#snippet motionCell\([\s\S]*?class:stale-cue=\{linkDown\}/);
    expect(strip).toContain('class:stale-cue={linkDown && !shallowAlarming}');
  });
});

describe('design contract: layout breakpoints', () => {
  const LANDSCAPE = LANDSCAPE_SHORT_QUERY;
  const strip = sources['/src/app/StatusStrip.svelte'] ?? '';
  const pinned = sources['/src/features/menu/PinnedActions.svelte'] ?? '';

  it('spells the landscape phone condition in CSS exactly as the shared query', () => {
    for (const [path, text] of nonTestSources()) {
      const all = text.match(/max-height: 500px/g)?.length ?? 0;
      expect(all, path).toBe(text.split(LANDSCAPE).length - 1);
    }
  });

  it('asks script breakpoint questions through the shared queries', () => {
    expect(
      hits(/['"`]\(max-width: (?:600|900)px\)['"`]|max-width: \$\{/).filter(
        (path) => path !== '/src/shared/lib/media.svelte.ts',
      ),
    ).toEqual([]);
  });

  it('keeps the status strip on one row on a phone held sideways', () => {
    const landscape = strip.indexOf(`@media ${LANDSCAPE} {`);
    expect(landscape).toBeGreaterThan(strip.indexOf('@media (max-width: 900px) {'));
    // One row only while three readout columns fit beside the tiles, in rem, so very large text
    // drops the tiles back onto their own row instead of squeezing the readouts into one column.
    expect(strip.slice(landscape)).toMatch(
      /@container status-strip \(min-width: \d+rem\) \{\s*\.strip-grid \{\s*grid-template-columns: var\(--strip-gutter\) minmax\(0, 1fr\) auto;/,
    );
    const pinnedLandscape = pinned.indexOf(`@media ${LANDSCAPE} {`);
    // The tiles' sideways rule follows their base rule, so it wins the cascade.
    expect(pinnedLandscape).toBeGreaterThan(pinned.indexOf('.pinned-actions {'));
    expect(pinned.slice(pinnedLandscape)).toMatch(
      /\.pinned-actions \{[^}]*margin-inline-start: auto;/,
    );
    expect(pinned).toContain('createMediaQuery(LANDSCAPE_SHORT_QUERY)');
    expect(pinned).toContain("'blocked-pill-note transient-note--end'");
    expect(sources['/src/styles/overlays.css'] ?? '').toMatch(
      /\.transient-note--end \{[^}]*inset-inline-end: 0;[^}]*transform: none;/,
    );
  });
});

describe('design contract: motion', () => {
  it('moves every arriving surface through the shared surface transition', () => {
    expect(hits(/transition:(fly|scale)\b/)).toEqual([]);
    for (const path of [
      '/src/shared/ui/SlideOver.svelte',
      '/src/shared/ui/AnchoredMenu.svelte',
      '/src/widgets/weather-map/WeatherMap.svelte',
    ])
      expect(sources[path] ?? '', path).toContain('transition:surfaceTransition=');
  });

  it('never animates a safety surface in', () => {
    // An entrance on an alarm or on the MOB flow delays the moment it can be read and acted on.
    for (const path of [
      '/src/features/anchor-watch/AnchorStrip.svelte',
      '/src/features/lookout/AlarmStrip.svelte',
      '/src/features/lookout/DangerStrip.svelte',
      '/src/features/lookout/ShallowStrip.svelte',
      '/src/features/mob/MobStrip.svelte',
      '/src/features/mob/MobButton.svelte',
      '/src/features/mob/MobConfirmDialog.svelte',
      '/src/widgets/safety-alert-stack/SafetyAlertStack.svelte',
    ]) {
      const text = sources[path];
      expect(text, path).toBeDefined();
      expect(text, path).not.toMatch(/\s(transition|in|out|animate):[a-zA-Z]/);
      expect(text, path).not.toMatch(/animation(-name)?:\s*(?!none\b)[a-z]/);
    }
  });

  it('raises the app menu as a sheet where it is one', () => {
    const menu = sources['/src/features/menu/AppMenu.svelte'] ?? '';
    expect(menu).toContain('createMediaQuery(COMPACT_QUERY)');
    expect(menu).toContain("motion={sheetLayout.matches ? 'below' : 'grow'}");
  });

  it('shares one easing curve between CSS and the surface transitions', () => {
    expect(tokens).toContain('--ease-out: cubic-bezier(0.33, 1, 0.68, 1);');
    expect(tokens).toContain('--transition-fast: 120ms var(--ease-out);');
    expect(sources['/src/shared/ui/transitions.ts'] ?? '').toContain('easing: cubicOut');
  });
});

describe('design contract: touch', () => {
  const base = sources['/src/styles/base.css'] ?? '';
  const menu = sources['/src/features/menu/AppMenu.svelte'] ?? '';

  it('never lets a pull reload the app or flash a gray tap box', () => {
    expect(base).toMatch(
      /html,\s*body \{[^}]*overscroll-behavior: none;[^}]*-webkit-tap-highlight-color: transparent;/,
    );
  });

  it('keeps a scroll inside its panel or sheet', () => {
    expect(sources['/src/styles/panels.css'] ?? '').toMatch(
      /\.panel-body \{[^}]*overscroll-behavior: contain;/,
    );
    expect(menu).toMatch(/\.launcher-scroll \{[^}]*overscroll-behavior: contain;/);
  });

  it('makes a quick second tap on a control a tap, not a zoom', () => {
    expect(base).toMatch(
      /a,\s*button,\s*input,\s*label,\s*select,\s*summary,\s*textarea,\s*\[role="button"\],\s*\[role="switch"\] \{\s*touch-action: manipulation;/,
    );
  });

  it('keeps the pressed state working on iOS without the tap highlight', () => {
    const main = sources['/src/main.ts'] ?? '';
    expect(main).toContain("addEventListener('touchstart'");
    expect(main).toContain('passive: true');
  });

  it('draws no grab handle on a sheet that cannot be dragged', () => {
    expect(menu).not.toContain('.launcher)::before');
  });
});

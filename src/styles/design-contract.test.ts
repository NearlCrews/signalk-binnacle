import { describe, expect, it } from 'vitest';

// Every stylesheet and component as text. A design rule that drifted twice is guarded here rather
// than reviewed again: each assertion names the rule it holds.
const sources = import.meta.glob<string>(['/src/**/*.{css,svelte,ts}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const tokens = sources['/src/styles/tokens.css'] ?? '';
const forms = sources['/src/styles/forms.css'] ?? '';

function hits(pattern: RegExp): string[] {
  return Object.entries(sources)
    .filter(([path, text]) => !path.endsWith('.test.ts') && pattern.test(text))
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

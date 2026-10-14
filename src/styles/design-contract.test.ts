import { describe, expect, it } from 'vitest';

// Every stylesheet and component as text. A design rule that drifted twice is guarded here rather
// than reviewed again: each assertion names the rule it holds.
const sources = import.meta.glob<string>(['/src/**/*.{css,svelte}'], {
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

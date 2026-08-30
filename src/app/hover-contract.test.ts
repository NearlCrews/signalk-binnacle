import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('../**/*.{css,svelte}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function styleBlocks(path: string, source: string): string[] {
  if (path.endsWith('.css')) return [source];
  return [...source.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map(
    (match) => match[1] ?? '',
  );
}

function unguardedHoverSelectors(source: string): number {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const token = /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)|:hover|[{}]/g;
  const hoverContext: boolean[] = [];
  let pendingHoverMedia = false;
  let failures = 0;
  for (const match of css.matchAll(token)) {
    const value = match[0];
    if (value.startsWith('@media')) {
      pendingHoverMedia = true;
    } else if (value === '{') {
      hoverContext.push((hoverContext.at(-1) ?? false) || pendingHoverMedia);
      pendingHoverMedia = false;
    } else if (value === '}') {
      hoverContext.pop();
    } else if (!(hoverContext.at(-1) ?? false)) {
      failures += 1;
    }
  }
  return failures;
}

describe('touch hover contract', () => {
  it('gates every hover selector to a fine pointer that actually supports hover', () => {
    const failures = Object.entries(sources).flatMap(([path, source]) =>
      styleBlocks(path, source)
        .map((block) => unguardedHoverSelectors(block))
        .filter((count) => count > 0)
        .map((count) => `${path}: ${count}`),
    );

    expect(failures).toEqual([]);
  });
});

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { isFenceDelimiter, unresolvableStoreLinks } from './store-links.mjs';

const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.md',
  '.mdx',
  '.mjs',
  '.scss',
  '.sh',
  '.svelte',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const proseExtensions = new Set(['.md', '.mdx', '.txt']);
// The two files the Signal K App Store renders from the published tarball.
const storeRenderedFiles = new Set(['README.md', 'CHANGELOG.md']);

const workingTree = spawnSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    encoding: 'utf8',
  },
);
if (workingTree.error || workingTree.status !== 0) {
  const detail = workingTree.error?.message ?? workingTree.stderr.trim() ?? 'git ls-files failed';
  console.error(`Unable to enumerate working-tree prose: ${detail}`);
  process.exit(1);
}

const checked = workingTree.stdout
  .split('\0')
  .filter(Boolean)
  .filter(existsSync)
  .filter((path) => path !== 'package-lock.json' && textExtensions.has(posix.extname(path)));
/** @type {string[]} */
const failures = [];

for (const path of checked) {
  const source = readFileSync(path, 'utf8');
  const prose = proseExtensions.has(posix.extname(path));
  let inFence = false;
  source.split('\n').forEach((line, index) => {
    const at = `${path}:${index + 1}`;
    if (line.includes('\u2014')) failures.push(`${at} contains an em dash.`);
    // The Signal K App Store category keyword is the one spec-required hyphenated form.
    if (/chart[ -]plotter/iu.test(line.replaceAll('signalk-category-chart-plotters', ''))) {
      failures.push(`${at} spells "chartplotter" as two words.`);
    }
    if (!prose) return;
    if (isFenceDelimiter(line)) {
      inFence = !inFence;
      return;
    }
    // Prose files only: in code a bare "&" is legitimate syntax (operators, intersection
    // types, URL query separators), so flagging it there would drown in false positives.
    if (!inFence && /(?:^|\s)&(?:\s|$)/u.test(line)) {
      failures.push(`${at} uses "&" where prose requires "and".`);
    }
  });
  if (!storeRenderedFiles.has(path)) continue;
  for (const { line, target } of unresolvableStoreLinks(source)) {
    failures.push(
      `${path}:${line} links to "${target}"; the Signal K App Store resolves only http, https, mailto, and #anchor link targets.`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Prose policy verified: ${checked.length} working-tree text files.`);

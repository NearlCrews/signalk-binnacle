import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

const proseOnly = process.argv.includes('--prose-only');
const requireDatedChangelog = process.argv.includes('--release');
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
const markdownImage = /!\[[^\]]*\]\([^)]*\)/gu;
const markdownLinkTarget = /\]\(\s*([^)\s]+)/gu;
const resolvableLinkTarget = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu;

function verifyProse() {
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
    const lines = readFileSync(path, 'utf8').split('\n');
    const prose = proseExtensions.has(posix.extname(path));
    const storeRendered = storeRenderedFiles.has(path);
    let inFence = false;
    lines.forEach((line, index) => {
      const at = `${path}:${index + 1}`;
      if (line.includes('\u2014')) failures.push(`${at} contains an em dash.`);
      // The Signal K App Store category keyword is the one spec-required hyphenated form.
      if (/chart[ -]plotter/iu.test(line.replaceAll('signalk-category-chart-plotters', ''))) {
        failures.push(`${at} spells "chartplotter" as two words.`);
      }
      if (!prose) return;
      if (/^\s*(?:```|~~~)/u.test(line)) {
        inFence = !inFence;
        return;
      }
      // Prose files only: in code a bare "&" is legitimate syntax (operators, intersection
      // types, URL query separators), so flagging it there would drown in false positives.
      if (!inFence && /(?:^|\s)&(?:\s|$)/u.test(line)) {
        failures.push(`${at} uses "&" where prose requires "and".`);
      }
      if (inFence || !storeRendered) return;
      // The App Store README view renders link targets unmodified, so a relative file link is
      // dead there. In-page anchors still work, and image paths are rewritten against the
      // package root, so both are dropped before the remaining targets are checked.
      for (const [, target] of line.replace(markdownImage, '').matchAll(markdownLinkTarget)) {
        if (!resolvableLinkTarget.test(target)) {
          failures.push(
            `${at} links to "${target}"; the Signal K App Store cannot resolve a relative link.`,
          );
        }
      }
      // A reference-style definition carries a target the inline scan above cannot see. Footnote
      // definitions ([^1]:) carry prose, not a target, so they are excluded.
      const reference = /^\s{0,3}\[[^\]^][^\]]*\]:\s*(\S+)/u.exec(line);
      if (reference && !resolvableLinkTarget.test(reference[1])) {
        failures.push(
          `${at} defines a reference link to "${reference[1]}"; the Signal K App Store cannot resolve a relative link.`,
        );
      }
    });
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }

  console.log(`Prose policy verified: ${checked.length} working-tree text files.`);
}

verifyProse();
if (proseOnly) process.exit(0);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const metadataFailures = [];

if (packageLock.version !== packageJson.version) {
  metadataFailures.push(
    `package-lock.json version ${packageLock.version} does not match package.json ${packageJson.version}.`,
  );
}
if (packageLock.packages?.['']?.version !== packageJson.version) {
  metadataFailures.push(
    `package-lock.json root version ${packageLock.packages?.['']?.version ?? 'missing'} does not match package.json ${packageJson.version}.`,
  );
}

const escapedVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const versionHeadings = [
  ...changelog.matchAll(
    new RegExp(`^## \\[${escapedVersion}\\] - (Unreleased|\\d{4}-\\d{2}-\\d{2})$`, 'gm'),
  ),
];
if (versionHeadings.length !== 1) {
  metadataFailures.push(
    `CHANGELOG.md must contain exactly one ${packageJson.version} heading marked Unreleased or dated YYYY-MM-DD.`,
  );
} else if (requireDatedChangelog && versionHeadings[0][1] === 'Unreleased') {
  metadataFailures.push(`CHANGELOG.md is missing a dated ${packageJson.version} release heading.`);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string | undefined}
 */
function publicMetadataPath(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    metadataFailures.push(`${label} must be a non-empty string.`);
    return undefined;
  }
  const relative = value.replace(/^\.\//u, '');
  const normalized = posix.normalize(relative);
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    metadataFailures.push(`${label} must stay within the packaged public directory.`);
    return undefined;
  }
  return `public/${normalized}`;
}

const appIcon = publicMetadataPath(packageJson.signalk?.appIcon, 'signalk.appIcon');
const screenshotValues = packageJson.signalk?.screenshots;
if (!Array.isArray(screenshotValues) || screenshotValues.length === 0) {
  metadataFailures.push('signalk.screenshots must contain at least one path.');
}
const screenshots = Array.isArray(screenshotValues)
  ? screenshotValues
      .map((value, index) => publicMetadataPath(value, `signalk.screenshots[${index}]`))
      .filter(Boolean)
  : [];

if (metadataFailures.length > 0) {
  console.error(metadataFailures.join('\n'));
  process.exit(1);
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('Package validation must run through npm so npm_execpath is available.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [npmCli, 'pack', '--dry-run', '--ignore-scripts', '--json'],
  {
    encoding: 'utf8',
  },
);

if (result.error) {
  console.error(`Unable to run npm pack: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);
  process.exit(result.status ?? 1);
}

/** @type {{ files: { path: string }[], entryCount: number, unpackedSize: number }} */
const report = JSON.parse(result.stdout)[0];
const paths = new Set(report.files.map((file) => file.path));
const required = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'package.json',
  'public/apple-touch-icon.png',
  'public/binnacle-icon-maskable.svg',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/icon-maskable-192.png',
  'public/icon-maskable-512.png',
  'public/index.html',
  'public/manifest.webmanifest',
  'public/sw.js',
  appIcon,
  ...screenshots,
].filter((path) => path !== undefined);
const missing = required.filter((path) => !paths.has(path));
const forbidden = [...paths].filter(
  (path) =>
    path.endsWith('.map') ||
    path.startsWith('coverage/') ||
    path.startsWith('e2e/') ||
    path.startsWith('playwright-report/') ||
    path.startsWith('src/') ||
    path.startsWith('test-results/'),
);
const hasJavaScript = [...paths].some((path) => /^public\/assets\/.*\.js$/.test(path));
const hasCss = [...paths].some((path) => /^public\/assets\/.*\.css$/.test(path));

if (missing.length > 0 || forbidden.length > 0 || !hasJavaScript || !hasCss) {
  if (missing.length > 0) console.error(`Missing package files: ${missing.join(', ')}`);
  if (forbidden.length > 0) console.error(`Forbidden package files: ${forbidden.join(', ')}`);
  if (!hasJavaScript) console.error('Missing generated JavaScript assets.');
  if (!hasCss) console.error('Missing generated CSS assets.');
  process.exit(1);
}

console.log(`Package contents verified: ${report.entryCount} files, ${report.unpackedSize} bytes.`);

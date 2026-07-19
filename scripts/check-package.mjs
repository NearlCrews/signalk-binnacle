import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const proseOnly = process.argv.includes('--prose-only');
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

function verifyProse() {
  const tracked = spawnSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
  });
  if (tracked.error || tracked.status !== 0) {
    const detail = tracked.error?.message ?? tracked.stderr.trim() ?? 'git ls-files failed';
    console.error(`Unable to enumerate tracked prose: ${detail}`);
    process.exit(1);
  }

  const checked = tracked.stdout
    .split('\0')
    .filter(Boolean)
    .filter((path) => path !== 'package-lock.json' && textExtensions.has(posix.extname(path)));
  const failures = [];

  for (const path of checked) {
    const lines = readFileSync(path, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.includes('\u2014')) failures.push(`${path}:${index + 1} contains an em dash.`);
    });
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }

  console.log(`Prose policy verified: ${checked.length} tracked text files.`);
}

verifyProse();
if (proseOnly) process.exit(0);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const readme = readFileSync('README.md', 'utf8');
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
if (!new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelog)) {
  metadataFailures.push(`CHANGELOG.md is missing a dated ${packageJson.version} release heading.`);
}

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

const readmeGuides = new Set();
for (const match of readme.matchAll(/\]\((docs\/[^\s)#?]+\.md)(?:#[^)]*)?\)/gu)) {
  readmeGuides.add(match[1]);
}

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

const report = JSON.parse(result.stdout)[0];
const paths = new Set(report.files.map((file) => file.path));
const required = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'package.json',
  'public/apple-touch-icon.png',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/index.html',
  'public/manifest.webmanifest',
  'public/sw.js',
  appIcon,
  ...screenshots,
  ...readmeGuides,
].filter(Boolean);
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

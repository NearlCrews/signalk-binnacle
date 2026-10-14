import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { bundledNoticeFailures } from './bundled-notices.mjs';

const requireDatedChangelog = process.argv.includes('--release');
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

// npm 11 prints an array of package reports; npm 12 prints an object keyed by package name.
// Object.values collapses both shapes to the single report.
/** @type {{ files: { path: string }[], entryCount: number, unpackedSize: number }} */
const report = Object.values(JSON.parse(result.stdout))[0];
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
  'public/THIRD_PARTY_NOTICES.txt',
  'public/THIRD_PARTY_NOTICES.json',
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

try {
  const noticeFailures = bundledNoticeFailures(
    JSON.parse(readFileSync('public/THIRD_PARTY_NOTICES.json', 'utf8')),
    readFileSync('public/THIRD_PARTY_NOTICES.txt', 'utf8'),
    paths,
  );
  if (noticeFailures.length) {
    console.error(noticeFailures.join('\n'));
    process.exit(1);
  }
} catch (error) {
  console.error(
    `Unable to verify bundled third-party notices: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
console.log('Bundled third-party notices verified.');

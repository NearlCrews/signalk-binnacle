import { spawnSync } from 'node:child_process';

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
  'public/binnacle-icon.svg',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/index.html',
  'public/manifest.webmanifest',
  'public/screenshots/01-chart.png',
  'public/screenshots/02-instruments.png',
  'public/screenshots/03-charts-overlays.png',
  'public/screenshots/04-weather.png',
  'public/screenshots/05-routes.png',
  'public/sw.js',
];
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

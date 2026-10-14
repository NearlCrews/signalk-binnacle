import { readdirSync, readFileSync } from 'node:fs';
import { devices } from '@playwright/test';
import {
  browserInstallFailures,
  isFullAudit,
  leafCommands,
  matchesNodeFloor,
  parseWorkflow,
  playwrightProjectEngines,
  vitestBrowserEngines,
  workflowFailures,
} from './workflow-policy.mjs';

const workflowDir = '.github/workflows';
const workflowPaths = readdirSync(workflowDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()
  .map((name) => `${workflowDir}/${name}`);
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageManagerMatch = /^npm@(.+)$/u.exec(packageJson.packageManager ?? '');
if (!packageManagerMatch) {
  console.error('package.json packageManager must pin npm with the npm@<version> form.');
  process.exit(1);
}
const supportedNpmVersion = packageManagerMatch[1];
const failures = [];

// engines.node is the single source of the Node floor; the copies that exist for tooling must
// agree with it, or CI tests a different floor than the published package advertises.
const enginesMatch = /^>=(\d+\.\d+(?:\.\d+)?)$/u.exec(packageJson.engines?.node ?? '');
if (!enginesMatch) {
  failures.push('package.json engines.node must declare the floor in the >=<version> form.');
} else {
  const nodeFloor = enginesMatch[1];
  const devEnginesVersion = packageJson.devEngines?.runtime?.version ?? '';
  if (devEnginesVersion !== `>=${nodeFloor}`) {
    failures.push(
      `package.json devEngines.runtime.version must match engines.node >=${nodeFloor}.`,
    );
  }
  const nodeVersionFile = readFileSync('.node-version', 'utf8').trim();
  if (!matchesNodeFloor(nodeVersionFile, nodeFloor)) {
    failures.push(
      `.node-version (${nodeVersionFile}) must pin the engines.node floor ${nodeFloor}.`,
    );
  }
  const webappCi = readFileSync(`${workflowDir}/signalk-webapp-ci.yml`, 'utf8');
  const matrixValues = parseWorkflow(webappCi).jobs?.['build-test-pack']?.strategy?.matrix?.node;
  const matrixEntries = Array.isArray(matrixValues) ? matrixValues.map(String) : [];
  if (!matrixEntries.some((entry) => matchesNodeFloor(entry, nodeFloor))) {
    failures.push(
      `signalk-webapp-ci.yml matrix must test the engines.node floor ${nodeFloor} (found: ${matrixEntries.join(', ') || 'none'}).`,
    );
  }
}

// Browser engines come from the suite configs themselves, so adding a WebKit or Firefox project
// fails here until every workflow that runs the suite installs that engine.
const scripts = packageJson.scripts ?? {};
const e2e = playwrightProjectEngines(readFileSync('playwright.config.ts', 'utf8'), devices);
const vitest = vitestBrowserEngines(readFileSync('vite.config.ts', 'utf8'));
failures.push(...e2e.failures, ...vitest.failures);

for (const path of workflowPaths) {
  const source = readFileSync(path, 'utf8');
  failures.push(...workflowFailures(source, path, supportedNpmVersion));
  failures.push(
    ...browserInstallFailures(source, path, scripts, { e2e: e2e.engines, vitest: vitest.engines }),
  );
}

// verify is the pre-push gate: no Playwright suite and no network audit. The browser libraries ship
// bundled from devDependencies, so the full audit is this webapp's real runtime audit and gates both
// CI (verify:ci) and publication (verify:release).
const pushGate = leafCommands('npm run verify', scripts);
if (pushGate.some((command) => /\bplaywright\s+test\b/u.test(command))) {
  failures.push(
    'package.json verify must not run the Playwright suite; that belongs in verify:browser.',
  );
}
if (pushGate.some(isFullAudit)) {
  failures.push('package.json verify must not run the full dependency audit; verify:ci does.');
}
for (const name of ['verify:ci', 'verify:release']) {
  if (!leafCommands(`npm run ${name}`, scripts).some(isFullAudit)) {
    failures.push(`package.json ${name} must run the full dependency audit.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Workflow bootstrap, browser installs, and gate composition verified.');

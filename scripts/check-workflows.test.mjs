import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  browserInstallFailures,
  isFullAudit,
  leafCommands,
  matchesNodeFloor,
  playwrightProjectEngines,
  vitestBrowserEngines,
  workflowFailures,
} from './workflow-policy.mjs';

const setup = `      - uses: actions/setup-node@pinned
        with:
          node-version: 22.18.0
          package-manager-cache: false`;
const bootstrap = `      - run: npm install --global npm@11.19.0
        working-directory: \${{ runner.temp }}`;
const install = '      - run: npm ci';
/** @param {string[]} steps */
const workflow = (steps) => `jobs:\n  verify:\n    steps:\n${steps.join('\n')}\n`;
/** @param {string} source */
const check = (source) => workflowFailures(source, '.github/workflows/ci.yml', '11.19.0');

test('accepts ordered bootstrap and ignores comments and unrelated jobs', () => {
  const source = `${workflow([setup, bootstrap, install])}  security:\n    steps:\n      - run: echo safe\n# npm ci\n`;
  assert.deepEqual(check(source), []);
});

test('rejects npm before bootstrap, even when bootstrap exists later', () => {
  assert.match(check(workflow([setup, install, bootstrap])).join('\n'), /before repository/u);
});

test('rejects npx before bootstrap', () => {
  assert.ok(check(workflow([setup, '      - run: npx playwright install', bootstrap])).length);
});

test('does not borrow another job bootstrap', () => {
  const source = `${workflow([setup, bootstrap, install])}  publish:\n    steps:\n${setup}\n${install}\n`;
  assert.match(check(source).join('\n'), /job publish/u);
});

test('does not borrow a neighboring step working directory', () => {
  const misplaced = `${bootstrap.replace('        working-directory:', '      - working-directory:')}\n        run: echo safe`;
  assert.match(check(workflow([setup, misplaced, install])).join('\n'), /outside the repository/u);
});

test('checks cache configuration inside the setup step, not neighboring text', () => {
  const misplaced = setup.replace('          package-manager-cache: false', '');
  const unrelated = `${bootstrap}\n        env:\n          package-manager-cache: false`;
  assert.match(check(workflow([misplaced, unrelated, install])).join('\n'), /disable setup-node/u);
  assert.match(
    check(workflow([`${setup}\n          cache: npm`, bootstrap])).join('\n'),
    /npm cache/u,
  );
});

test('requires exact npm version and an unconditional bootstrap', () => {
  assert.ok(check(workflow([setup, bootstrap.replace('11.19.0', '11.19.01'), install])).length);
  assert.ok(check(workflow([setup, `${bootstrap}\n        if: false`, install])).length);
});

test('a second setup invalidates the previous bootstrap', () => {
  assert.ok(check(workflow([setup, bootstrap, setup, install])).length);
});

test('requires setup before bootstrap', () => {
  assert.ok(check(workflow([bootstrap, setup, install])).length);
});

test('comments cannot provide missing commands or publish requirements', () => {
  assert.ok(check(workflow([setup, `# ${bootstrap.replaceAll('\n', '\n# ')}`, install])).length);
  assert.ok(
    workflowFailures(
      '# npm publish ./artifacts/*.tgz --provenance --access public',
      '.github/workflows/publish.yml',
      '11.19.0',
    ).length,
  );
});

test('rejects malformed YAML and duplicate job keys', () => {
  assert.match(check('jobs: [').join('\n'), /invalid YAML/u);
  assert.match(check('jobs: {}\njobs: {}').join('\n'), /invalid YAML/u);
});

test('normalizes Node floor numerically instead of matching string prefixes', () => {
  assert.equal(matchesNodeFloor('22.18.0', '22.18'), true);
  for (const version of ['22.180.0', '22.18.01', '22.18.0-extra', '22.18.1', '22']) {
    assert.equal(matchesNodeFloor(version, '22.18'), false, version);
  }
});

const scripts = {
  test: 'vitest run',
  'test:e2e:gate': 'playwright test',
  'audit:runtime': 'npm audit --omit=dev --audit-level=high',
  'audit:full': 'npm audit --audit-level=high',
  verify: 'npm run test && npm run audit:runtime',
  'verify:ci': 'npm run verify && npm run test:e2e:gate',
  'verify:release': 'npm run verify:ci && npm run audit:full',
};
const devices = {
  'Desktop Chrome': { defaultBrowserType: 'chromium' },
  'Desktop Safari': { defaultBrowserType: 'webkit' },
  'iPhone 13': { defaultBrowserType: 'webkit' },
};
const suites = {
  e2e: new Map([
    ['chromium', 'chromium'],
    ['webkit-smoke', 'webkit'],
  ]),
  vitest: new Set(['chromium']),
};
/** @param {string[]} commands */
const browserJob = (commands) =>
  `on: push\njobs:\n  verify:\n    steps:\n${commands.map((command) => `      - run: ${command}`).join('\n')}\n`;
/** @param {string} source */
const installCheck = (source) => browserInstallFailures(source, 'ci.yml', scripts, suites);

test('expands npm scripts into leaf commands and appends forwarded arguments', () => {
  assert.deepEqual(leafCommands('npm run verify:release', scripts), [
    'vitest run',
    'npm audit --omit=dev --audit-level=high',
    'playwright test',
    'npm audit --audit-level=high',
  ]);
  assert.deepEqual(leafCommands('npm run --silent test:e2e:gate -- --project=chromium', scripts), [
    'playwright test --project=chromium',
  ]);
  assert.deepEqual(leafCommands('npm test', scripts), ['vitest run']);
  assert.deepEqual(leafCommands('npm ci', scripts), ['npm ci']);
});

test('derives Playwright engines from devices presets and explicit browser names', () => {
  const config = `export default defineConfig({
  // projects: [{ name: 'commented', use: { ...devices['Desktop Firefox'] } }],
  projects: [
    { name: 'webkit-smoke', testMatch: [/a\\.spec\\.ts/, /b\\.spec\\.ts/], use: { ...devices['Desktop Safari'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], baseURL: ORIGIN } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
});`;
  const { engines, failures } = playwrightProjectEngines(config, devices);
  assert.deepEqual(failures, []);
  assert.deepEqual(Object.fromEntries(engines), {
    'webkit-smoke': 'webkit',
    chromium: 'chromium',
    firefox: 'firefox',
  });
});

test('fails a Playwright project whose engine cannot be derived', () => {
  const config = `projects: [
    { name: 'mystery', use: { viewport: { width: 1, height: 1 } } },
    { name: 'unknown-device', use: { ...devices['Galaxy Fold 9'] } },
  ]`;
  const { failures } = playwrightProjectEngines(config, devices);
  assert.equal(failures.length, 2);
  assert.match(failures[0], /mystery/u);
  assert.match(playwrightProjectEngines('export default {}', devices).failures[0], /no projects/u);
});

test('derives Vitest browser instances and rejects a provider without instances', () => {
  const config =
    "browser: { provider: playwright(), instances: [{ browser: 'chromium' }, { browser: 'webkit' }] }";
  assert.deepEqual([...vitestBrowserEngines(config).engines], ['chromium', 'webkit']);
  assert.ok(vitestBrowserEngines('browser: { provider: playwright() }').failures.length);
  assert.deepEqual(vitestBrowserEngines('test: { environment: "node" }'), {
    engines: new Set(),
    failures: [],
  });
});

test('requires every engine a browser suite launches to be installed first', () => {
  assert.deepEqual(
    installCheck(
      browserJob(['npx playwright install --with-deps chromium webkit', 'npm run verify:ci']),
    ),
    [],
  );
  assert.deepEqual(installCheck(browserJob(['npx playwright install', 'npm run verify:ci'])), []);
  assert.match(
    installCheck(browserJob(['npx playwright install chromium', 'npm run verify:ci'])).join('\n'),
    /Playwright suite \(chromium, webkit\) without first installing webkit/u,
  );
  assert.match(
    installCheck(browserJob(['npm test', 'npx playwright install chromium'])).join('\n'),
    /Vitest browser mode/u,
  );
  assert.deepEqual(
    installCheck(
      browserJob([
        'npx playwright install chromium',
        'npm run test:e2e:gate -- --project=chromium',
      ]),
    ),
    [],
  );
  assert.ok(installCheck(browserJob(['npx playwright install-deps', 'npm test'])).length);
});

test('tells the full audit apart from the runtime audit', () => {
  assert.equal(isFullAudit('npm audit --audit-level=high'), true);
  assert.equal(isFullAudit('npm audit'), true);
  assert.equal(isFullAudit('npm audit --omit=dev --audit-level=high'), false);
  assert.equal(isFullAudit('npm audit --omit dev'), false);
  assert.equal(isFullAudit('npm auditor'), false);
  assert.deepEqual(leafCommands('npm run verify:release', scripts).filter(isFullAudit), [
    'npm audit --audit-level=high',
  ]);
});

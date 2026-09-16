import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesNodeFloor, workflowFailures } from './workflow-policy.mjs';

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

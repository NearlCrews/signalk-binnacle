import { readdirSync, readFileSync } from 'node:fs';
import { matchesNodeFloor, parseWorkflow, workflowFailures } from './workflow-policy.mjs';

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

for (const path of workflowPaths) {
  failures.push(...workflowFailures(readFileSync(path, 'utf8'), path, supportedNpmVersion));
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Workflow package-manager bootstrap verified.');

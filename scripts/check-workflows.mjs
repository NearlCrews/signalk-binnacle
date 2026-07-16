import { readFileSync } from 'node:fs';

const workflowPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/publish.yml',
  '.github/workflows/signalk-webapp-ci.yml',
];
const runnerTempWorkingDirectory = `working-directory: ${'$'}{{ runner.temp }}`;
const failures = [];

for (const path of workflowPaths) {
  const lines = readFileSync(path, 'utf8').split('\n');

  lines.forEach((line, index) => {
    if (line.includes('uses: actions/setup-node@')) {
      const setupBlock = lines.slice(index, index + 8).join('\n');
      if (!setupBlock.includes('package-manager-cache: false')) {
        failures.push(`${path}:${index + 1} must disable setup-node package-manager caching.`);
      }
      if (/^\s+cache:\s*npm\s*$/mu.test(setupBlock)) {
        failures.push(`${path}:${index + 1} must not inspect npm cache before the npm upgrade.`);
      }
    }

    if (line.includes('npm install --global npm@')) {
      const installBlock = lines.slice(Math.max(0, index - 4), index + 1).join('\n');
      if (!installBlock.includes(runnerTempWorkingDirectory)) {
        failures.push(`${path}:${index + 1} must install npm outside the repository checkout.`);
      }
    }
  });
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Workflow package-manager bootstrap verified.');

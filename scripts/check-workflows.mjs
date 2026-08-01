import { readFileSync } from 'node:fs';

const workflowPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/publish.yml',
  '.github/workflows/signalk-webapp-ci.yml',
];
const runnerTempWorkingDirectory = `working-directory: ${'$'}{{ runner.temp }}`;
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageManagerMatch = /^npm@(.+)$/u.exec(packageJson.packageManager ?? '');
if (!packageManagerMatch) {
  console.error('package.json packageManager must pin npm with the npm@<version> form.');
  process.exit(1);
}
const supportedNpmVersion = packageManagerMatch[1];
const failures = [];

for (const path of workflowPaths) {
  const workflow = readFileSync(path, 'utf8');
  const lines = workflow.split('\n');
  let npmInstallCount = 0;

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
      npmInstallCount += 1;
      const installBlock = lines.slice(Math.max(0, index - 4), index + 1).join('\n');
      if (!installBlock.includes(runnerTempWorkingDirectory)) {
        failures.push(`${path}:${index + 1} must install npm outside the repository checkout.`);
      }
      if (!line.includes(`npm@${supportedNpmVersion}`)) {
        failures.push(
          `${path}:${index + 1} must install packageManager npm ${supportedNpmVersion}.`,
        );
      }
    }
  });

  if (npmInstallCount === 0) {
    failures.push(
      `${path} must install the packageManager npm version before repository commands.`,
    );
  }

  if (
    path === '.github/workflows/publish.yml' &&
    !workflow.includes('npm publish ./artifacts/*.tgz --provenance --access public')
  ) {
    failures.push(`${path} must publish the downloaded tarball with an explicit relative path.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Workflow package-manager bootstrap verified.');

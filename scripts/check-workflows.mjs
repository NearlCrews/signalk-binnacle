import { readdirSync, readFileSync } from 'node:fs';

const workflowDir = '.github/workflows';
const workflowPaths = readdirSync(workflowDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()
  .map((name) => `${workflowDir}/${name}`);
const runnerTempWorkingDirectory = `working-directory: ${'$'}{{ runner.temp }}`;
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
  if (!nodeVersionFile.startsWith(nodeFloor)) {
    failures.push(
      `.node-version (${nodeVersionFile}) must pin the engines.node floor ${nodeFloor}.`,
    );
  }
  const webappCi = readFileSync(`${workflowDir}/signalk-webapp-ci.yml`, 'utf8');
  const matrixMatch = /^\s*node: \[([^\]]+)\]/mu.exec(webappCi);
  const matrixEntries = matrixMatch ? matrixMatch[1].split(',').map((entry) => entry.trim()) : [];
  if (!matrixEntries.some((entry) => entry.startsWith(nodeFloor))) {
    failures.push(
      `signalk-webapp-ci.yml matrix must test the engines.node floor ${nodeFloor} (found: ${matrixEntries.join(', ') || 'none'}).`,
    );
  }
}

for (const path of workflowPaths) {
  const workflow = readFileSync(path, 'utf8');
  const lines = workflow.split('\n');
  const usesSetupNode = workflow.includes('uses: actions/setup-node@');
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

  // Any workflow that sets up Node runs npm against this repository, so it must bootstrap the
  // pinned npm first. Workflows without setup-node (CodeQL and kin) are exempt by construction.
  if (usesSetupNode && npmInstallCount === 0) {
    failures.push(
      `${path} must install the packageManager npm version before repository commands.`,
    );
  }

  if (
    path === `${workflowDir}/publish.yml` &&
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

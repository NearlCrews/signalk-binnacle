import { parse } from 'yaml';

/** @param {unknown} value @returns {Record<string, any>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** @param {string} version */
function normalizedVersion(version) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/u.exec(version);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3] ?? 0)}` : undefined;
}

/** @param {string} candidate @param {string} floor */
export function matchesNodeFloor(candidate, floor) {
  const expected = normalizedVersion(floor);
  return expected !== undefined && normalizedVersion(candidate) === expected;
}

/** @param {string} source @returns {Record<string, any>} */
export function parseWorkflow(source) {
  return record(parse(source, { maxAliasCount: 100, uniqueKeys: true }));
}

/**
 * Check each job independently: setup-node replaces npm, so every setup must be followed by the
 * pinned bootstrap before any npm or npx command. Comments never count as executable steps.
 * @param {string} source
 * @param {string} path
 * @param {string} npmVersion
 * @returns {string[]}
 */
export function workflowFailures(source, path, npmVersion) {
  const failures = [];
  let workflow;
  try {
    workflow = parseWorkflow(source);
  } catch (error) {
    return [`${path}: invalid YAML: ${error instanceof Error ? error.message : String(error)}`];
  }
  let publishesArtifact = false;
  for (const [jobName, value] of Object.entries(record(workflow.jobs))) {
    const job = record(value);
    const steps = Array.isArray(job.steps) ? job.steps : [];
    let hasNode = false;
    let hasBootstrap = false;
    for (const [index, value] of steps.entries()) {
      const step = record(value);
      const at = `${path}: job ${jobName}, step ${index + 1}`;
      if (typeof step.uses === 'string' && step.uses.startsWith('actions/setup-node@')) {
        hasNode = true;
        hasBootstrap = false;
        const options = record(step.with);
        if (options['package-manager-cache'] !== false) {
          failures.push(`${at} must disable setup-node package-manager caching.`);
        }
        if (options.cache === 'npm') {
          failures.push(`${at} must not inspect npm cache before the npm upgrade.`);
        }
        if (step.if !== undefined) failures.push(`${at} must set up Node unconditionally.`);
      }
      if (typeof step.run !== 'string') continue;
      const commands = step.run.split('\n').filter((line) => !/^\s*(?:#|$)/u.test(line));
      for (const command of commands) {
        if (command.trim() === 'npm publish ./artifacts/*.tgz --provenance --access public') {
          publishesArtifact = true;
        }
        const bootstrap = /^\s*npm install --global npm@(\S+)\s*$/u.exec(command);
        if (bootstrap) {
          const workingDirectory =
            step['working-directory'] ??
            record(record(job.defaults).run)['working-directory'] ??
            record(record(workflow.defaults).run)['working-directory'];
          const correctVersion = bootstrap[1] === npmVersion;
          const outsideCheckout = workingDirectory === `\${{ runner.temp }}`;
          const unconditional = step.if === undefined;
          if (!hasNode) failures.push(`${at} must set up Node before bootstrapping npm.`);
          if (!correctVersion)
            failures.push(`${at} must install packageManager npm ${npmVersion}.`);
          if (!outsideCheckout)
            failures.push(`${at} must install npm outside the repository checkout.`);
          if (!unconditional) failures.push(`${at} must bootstrap npm unconditionally.`);
          hasBootstrap = hasNode && correctVersion && outsideCheckout && unconditional;
        } else if (/\b(?:npm|npx)\b/u.test(command) && !hasBootstrap) {
          failures.push(
            `${at} must bootstrap the pinned npm before repository npm or npx commands.`,
          );
        }
      }
    }
    if (hasNode && !hasBootstrap) {
      failures.push(
        `${path}: job ${jobName} must bootstrap the pinned npm after its final Node setup.`,
      );
    }
  }
  if (path.endsWith('/publish.yml') && !publishesArtifact) {
    failures.push(`${path} must publish the downloaded tarball with an explicit relative path.`);
  }
  return failures;
}

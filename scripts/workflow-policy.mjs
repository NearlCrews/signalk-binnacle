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

/**
 * The executable lines of a run step; comments never count as commands.
 * @param {string} run
 */
function runLines(run) {
  return run.split('\n').filter((line) => !/^\s*(?:#|$)/u.test(line));
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
      for (const command of runLines(step.run)) {
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

const browserEngines = new Set(['chromium', 'firefox', 'webkit']);
/**
 * Expand npm script invocations into the leaf commands npm would run. Arguments after `--` attach
 * to the end of the expanded script, as npm itself appends them.
 * @param {string} command
 * @param {Record<string, string>} scripts
 * @param {Set<string>} [seen]
 * @returns {string[]}
 */
export function leafCommands(command, scripts, seen = new Set()) {
  return command.split('&&').flatMap((part) => {
    const trimmed = part.trim();
    const run = /^npm\s+(?:run|run-script)\s+(?:--silent\s+)?(\S+)(.*)$/u.exec(trimmed);
    const test = /^npm\s+(?:test|t)(?=\s|$)(.*)$/u.exec(trimmed);
    const name = run ? run[1] : test ? 'test' : undefined;
    const script = name === undefined ? undefined : scripts[name];
    if (name === undefined || typeof script !== 'string' || seen.has(name)) return [trimmed];
    const extra = (run ? run[2] : (test?.[1] ?? '')).replace(/^\s*--(?=\s|$)/u, '').trim();
    return leafCommands(extra ? `${script} ${extra}` : script, scripts, new Set([...seen, name]));
  });
}

/** @param {string} command */
export function isFullAudit(command) {
  return /^npm\s+audit(?:\s|$)/u.test(command) && !/--omit[=\s]+dev\b/u.test(command);
}

/** @param {string} source @param {number} open index of an opening square bracket */
function bracketBody(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '[') depth += 1;
    else if (source[index] === ']') depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  return undefined;
}

/** @param {string} source */
function withoutLineComments(source) {
  return source.replace(/^\s*\/\/.*$/gmu, '');
}

/**
 * Map each Playwright project to the browser engine it launches, from an explicit browserName or
 * the engine behind its devices[...] preset. A project with neither is a failure, so a new project
 * cannot slip past the workflow install check.
 * @param {string} source playwright.config.ts
 * @param {Record<string, { defaultBrowserType?: string }>} devices
 */
export function playwrightProjectEngines(source, devices) {
  /** @type {Map<string, string>} */
  const engines = new Map();
  /** @type {string[]} */
  const failures = [];
  const code = withoutLineComments(source);
  const start = /\bprojects\s*:\s*\[/u.exec(code);
  const body = start ? bracketBody(code, start.index + start[0].length - 1) : undefined;
  if (body === undefined)
    return { engines, failures: ['playwright.config.ts: no projects array found.'] };
  /** @type {string[]} */
  const projects = [];
  let depth = 0;
  let objectStart = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === '{') {
      if (depth === 0) objectStart = index;
      depth += 1;
    } else if (body[index] === '}') {
      depth -= 1;
      if (depth === 0) projects.push(body.slice(objectStart, index + 1));
    }
  }
  for (const [index, project] of projects.entries()) {
    const name = /\bname\s*:\s*['"]([^'"]+)['"]/u.exec(project)?.[1] ?? `#${index + 1}`;
    const device = /\bdevices\[\s*['"]([^'"]+)['"]\s*\]/u.exec(project)?.[1];
    const engine =
      /\bbrowserName\s*:\s*['"](\w+)['"]/u.exec(project)?.[1] ??
      (device === undefined ? undefined : devices[device]?.defaultBrowserType);
    if (engine === undefined || !browserEngines.has(engine)) {
      failures.push(
        `playwright.config.ts: project ${name} needs a browserName or a known devices[...] preset.`,
      );
    } else {
      engines.set(name, engine);
    }
  }
  if (engines.size === 0 && failures.length === 0) {
    failures.push('playwright.config.ts: the projects array declares no projects.');
  }
  return { engines, failures };
}

/**
 * The engines Vitest browser mode launches through its Playwright provider.
 * @param {string} source vite.config.ts
 */
export function vitestBrowserEngines(source) {
  /** @type {Set<string>} */
  const engines = new Set();
  /** @type {string[]} */
  const failures = [];
  const code = withoutLineComments(source);
  for (const start of code.matchAll(/\binstances\s*:\s*\[/gu)) {
    const body = bracketBody(code, (start.index ?? 0) + start[0].length - 1) ?? '';
    for (const [, engine] of body.matchAll(/\bbrowser\s*:\s*['"](\w+)['"]/gu)) {
      if (browserEngines.has(engine)) engines.add(engine);
      else failures.push(`vite.config.ts: unknown Vitest browser instance ${engine}.`);
    }
  }
  if (/\bprovider\s*:\s*playwright\(/u.test(code) && engines.size === 0 && failures.length === 0) {
    failures.push('vite.config.ts: the Playwright browser provider lists no browser instances.');
  }
  return { engines, failures };
}

/**
 * @param {string} command a leaf command
 * @param {{ e2e: Map<string, string>, vitest: Set<string> }} suites
 * @returns {{ suite: string, engines: string[] } | undefined}
 */
function browserNeeds(command, suites) {
  if (/\bplaywright\s+test\b/u.test(command)) {
    const selected = [...command.matchAll(/--project[=\s]+(\S+)/gu)].map((match) => match[1]);
    const engines = [...suites.e2e]
      .filter(([name]) => selected.length === 0 || selected.includes(name))
      .map(([, engine]) => engine);
    return { suite: 'the Playwright suite', engines: [...new Set(engines)].sort() };
  }
  if (/(?:^|\s)vitest(?:\s|$)/u.test(command) && suites.vitest.size > 0) {
    return { suite: 'Vitest browser mode', engines: [...suites.vitest].sort() };
  }
  return undefined;
}

/**
 * workflowFailures already reports a workflow that does not parse, so later checks skip it.
 * @param {string} source
 */
function parsedOrEmpty(source) {
  try {
    return parseWorkflow(source);
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, any>} job
 * @returns {{ at: number, command: string }[]}
 */
function jobCommands(job) {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  return steps.flatMap((value, index) => {
    const step = record(value);
    if (typeof step.run !== 'string') return [];
    return runLines(step.run).map((command) => ({ at: index + 1, command: command.trim() }));
  });
}

/**
 * Every job that runs a browser suite must install each engine the suite launches, before it runs.
 * @param {string} source
 * @param {string} path
 * @param {Record<string, string>} scripts
 * @param {{ e2e: Map<string, string>, vitest: Set<string> }} suites
 * @returns {string[]}
 */
export function browserInstallFailures(source, path, scripts, suites) {
  const failures = [];
  for (const [jobName, value] of Object.entries(record(parsedOrEmpty(source).jobs))) {
    /** @type {Set<string>} */
    const installed = new Set();
    let installsAll = false;
    for (const { at, command } of jobCommands(record(value))) {
      const install = /^npx\s+playwright\s+install(?=\s|$)(.*)$/u.exec(command);
      if (install) {
        const named = install[1].split(/\s+/u).filter((token) => token && !token.startsWith('-'));
        if (named.length === 0) installsAll = true;
        for (const engine of named) installed.add(engine);
        continue;
      }
      for (const leaf of leafCommands(command, scripts)) {
        const needs = browserNeeds(leaf, suites);
        const missing = installsAll
          ? []
          : (needs?.engines ?? []).filter((engine) => !installed.has(engine));
        if (needs && missing.length > 0) {
          failures.push(
            `${path}: job ${jobName}, step ${at} runs ${needs.suite} (${needs.engines.join(', ')}) without first installing ${missing.join(', ')} through npx playwright install.`,
          );
        }
      }
    }
  }
  return failures;
}

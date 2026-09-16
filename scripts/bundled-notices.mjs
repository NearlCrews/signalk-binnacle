import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** @typedef {{file: string, text: string, source?: string}} LicenseText */
/** @typedef {{name: string, version: string, license: string, licenses: LicenseText[], outputs: string[]}} PackageNotice */
/** @typedef {{schemaVersion: 1, buildScopes: string[], packages: PackageNotice[]}} NoticeManifest */

// These published tarballs omit their license. Each fallback is tied to a version and its npm
// gitHead, so an upgrade cannot silently reuse an upstream copyright notice without verification.
/** @type {Record<string, {file: string, source: string}>} */
const supplements = {
  'pmtiles@4.5.0': {
    file: 'pmtiles.txt',
    source:
      'https://github.com/protomaps/PMTiles/blob/3b10e67edb65c6b04549f74c0279cef8328d859c/LICENSE',
  },
  'terra-draw@1.32.3': {
    file: 'terra-draw.txt',
    source:
      'https://github.com/JamesLMilner/terra-draw/blob/7ab498b8cb6f79321c4222efcd2fe78a58f04595/LICENSE',
  },
  'terra-draw@1.33.0': {
    file: 'terra-draw.txt',
    source:
      'https://github.com/JamesLMilner/terra-draw/blob/b6d0c18779b204b054a99d5a6cc1906f95fb3503/LICENSE',
  },
  'terra-draw-maplibre-gl-adapter@1.4.1': {
    file: 'terra-draw.txt',
    source:
      'https://github.com/JamesLMilner/terra-draw/blob/569659537f827bf887027e1be25127f4009e96e7/LICENSE',
  },
};

/** @param {string} id @param {string} root */
function owningPackage(id, root) {
  if (id.startsWith('\0') || !id.replaceAll('\\', '/').includes('node_modules/')) return;
  let directory = dirname(resolve(root, id.split('?')[0]));
  while (directory !== dirname(directory)) {
    const metadataPath = join(directory, 'package.json');
    if (existsSync(metadataPath)) {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
      if (typeof metadata.name === 'string' && typeof metadata.version === 'string') {
        return {
          directory,
          name: metadata.name,
          version: metadata.version,
          license: metadata.license,
        };
      }
    }
    directory = dirname(directory);
  }
}

/** @param {NonNullable<ReturnType<typeof owningPackage>>} pkg @returns {LicenseText[]} */
function licenseTexts(pkg) {
  const files = readdirSync(pkg.directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^(?:license|licence|copying|notice|ofl)(?:[._-]|$)/iu.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  const texts = files.map((file) => ({
    file,
    text: readFileSync(join(pkg.directory, file), 'utf8').trim(),
  }));
  if (files.some((file) => !/^notice/iu.test(file)) && texts.every(({ text }) => text.length > 0))
    return texts;
  const key = `${pkg.name}@${pkg.version}`;
  const fallback = supplements[key];
  if (!fallback)
    throw new Error(
      `Bundled dependency ${key} has no complete license text; add a versioned upstream supplement.`,
    );
  return [
    ...texts,
    {
      file: 'LICENSE (upstream supplement)',
      text: readFileSync(new URL(`./licenses/${fallback.file}`, import.meta.url), 'utf8').trim(),
      source: fallback.source,
    },
  ];
}

/** @param {NoticeManifest} manifest */
export function renderBundledNotices(manifest) {
  return [
    'Binnacle bundled third-party notices',
    '',
    'The following packages contribute code or assets to this build. Their original license and',
    'notice texts follow. Binnacle itself is licensed separately under Apache-2.0.',
    '',
    ...manifest.packages.flatMap((pkg) => [
      '='.repeat(80),
      `${pkg.name}@${pkg.version} (${pkg.license})`,
      ...pkg.licenses.flatMap((license) => [
        '',
        license.file,
        ...(license.source ? [`Source: ${license.source}`] : []),
        '',
        license.text,
      ]),
      '',
    ]),
  ].join('\n');
}

/**
 * Share one collector between the app, Vite workers, and the Serwist child build. Emitted chunk
 * module IDs and asset origins, not installed dependencies, define the notice inventory. The
 * service-worker build runs last and emits the complete aggregate over the earlier app output.
 * @param {{root?: string}} [options]
 */
export function createBundledNotices({ root = process.cwd() } = {}) {
  /** @type {Map<string, PackageNotice>} */
  const packages = new Map();
  const scopes = new Set();
  /** @param {string} id @param {string} output */
  function add(id, output) {
    const pkg = owningPackage(id, root);
    if (!pkg) return;
    const key = `${pkg.name}@${pkg.version}`;
    let notice = packages.get(key);
    if (!notice) {
      if (typeof pkg.license !== 'string' || !pkg.license.trim()) {
        throw new Error(`Bundled dependency ${key} has no license identifier.`);
      }
      notice = {
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        licenses: licenseTexts(pkg),
        outputs: [],
      };
      packages.set(key, notice);
    }
    if (!notice.outputs.includes(output)) notice.outputs.push(output);
  }
  return {
    /** @param {'app' | 'worker' | 'service-worker'} scope @returns {import('vite').Plugin} */
    plugin(scope) {
      return {
        name: `binnacle-bundled-notices-${scope}`,
        apply: 'build',
        buildStart() {
          if (scope === 'app') {
            packages.clear();
            scopes.clear();
          }
        },
        generateBundle: {
          order: 'post',
          handler(_options, bundle) {
            scopes.add(scope);
            for (const output of Object.values(bundle)) {
              const ids = output.type === 'chunk' ? output.moduleIds : output.originalFileNames;
              for (const id of ids) add(id, output.fileName);
            }
            const manifest = {
              schemaVersion: /** @type {const} */ (1),
              buildScopes: [...scopes].sort(),
              packages: [...packages.values()]
                .map((pkg) => ({ ...pkg, outputs: [...pkg.outputs].sort() }))
                .sort((a, b) =>
                  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, 'en'),
                ),
            };
            // Workers contribute to the shared inventory but must not emit competing copies of
            // the aggregate into Vite's worker asset cache.
            if (scope === 'worker') return;
            this.emitFile({
              type: 'asset',
              fileName: 'THIRD_PARTY_NOTICES.txt',
              source: renderBundledNotices(manifest),
            });
            this.emitFile({
              type: 'asset',
              fileName: 'THIRD_PARTY_NOTICES.json',
              source: `${JSON.stringify(manifest, null, 2)}\n`,
            });
          },
        },
      };
    },
  };
}

/** Verify packaged evidence, including worker-only code and the emitted font licenses.
 * @param {unknown} value
 * @param {string} text
 * @param {Set<string>} packagePaths
 */
export function bundledNoticeFailures(value, text, packagePaths) {
  const failures = [];
  const manifest = /** @type {NoticeManifest | undefined} */ (value);
  if (
    manifest?.schemaVersion !== 1 ||
    !Array.isArray(manifest.packages) ||
    !manifest.packages.length ||
    !Array.isArray(manifest.buildScopes)
  ) {
    return ['Third-party notice manifest is empty or invalid.'];
  }
  for (const scope of ['app', 'worker', 'service-worker']) {
    if (!manifest.buildScopes.includes(scope))
      failures.push(`Third-party notices omit the ${scope} build.`);
  }
  const names = new Set();
  for (const pkg of manifest.packages) {
    if (
      !pkg ||
      typeof pkg.name !== 'string' ||
      typeof pkg.version !== 'string' ||
      typeof pkg.license !== 'string' ||
      !Array.isArray(pkg.licenses) ||
      !pkg.licenses.length ||
      !Array.isArray(pkg.outputs) ||
      !pkg.outputs.length
    ) {
      failures.push('Third-party notice manifest contains an incomplete package.');
      continue;
    }
    names.add(pkg.name);
    for (const license of pkg.licenses) {
      if (
        !license ||
        typeof license.file !== 'string' ||
        typeof license.text !== 'string' ||
        !license.text.trim()
      )
        failures.push(`Third-party notices omit license text for ${pkg.name}.`);
    }
    for (const output of pkg.outputs) {
      if (typeof output !== 'string' || !packagePaths.has(`public/${output}`))
        failures.push(`Third-party notices reference a missing packaged output for ${pkg.name}.`);
    }
  }
  for (const name of [
    'maplibre-gl',
    'serwist',
    '@fontsource-variable/inter',
    '@fontsource-variable/jetbrains-mono',
  ]) {
    if (!names.has(name)) failures.push(`Third-party notices omit bundled ${name}.`);
  }
  if (!failures.length && renderBundledNotices(manifest) !== text)
    failures.push('Third-party notice text does not match its bundled package inventory.');
  return failures;
}

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { build } from 'vite';
import {
  bundledNoticeFailures,
  createBundledNotices,
  renderBundledNotices,
} from './bundled-notices.mjs';

/** @param {string} root @param {string} path @param {string} content */
function writeFixture(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** @param {string} root @param {string} name @param {boolean} [license] */
function dependency(root, name, license = true) {
  writeFixture(
    root,
    `node_modules/${name}/package.json`,
    JSON.stringify({
      name,
      version: '1.0.0',
      main: 'index.js',
      license: 'MIT',
      sideEffects: false,
    }),
  );
  writeFixture(root, `node_modules/${name}/index.js`, `export const value = '${name}';`);
  if (license)
    writeFixture(
      root,
      `node_modules/${name}/LICENSE`,
      `Copyright ${name}\nPermission is granted for the test fixture.`,
    );
}

/** @param {string} root @param {string} entry @param {import('vite').Plugin[]} plugins */
async function bundle(root, entry, plugins) {
  const result = await build({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins,
    build: {
      write: false,
      minify: false,
      lib: { entry: join(root, entry), formats: ['es'], fileName: entry },
    },
  });
  assert.ok(Array.isArray(result));
  return result[0].output;
}

test('collects only emitted dependencies and assets across app, workers, and service worker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'binnacle-notices-'));
  try {
    for (const name of [
      'included',
      'unused',
      'worker-only',
      'serwist',
      '@fontsource-variable/inter',
      '@fontsource-variable/jetbrains-mono',
      'maplibre-gl',
    ])
      dependency(root, name);
    writeFixture(
      root,
      'app.js',
      "import {value} from 'included'; import {value as unused} from 'unused'; globalThis.fixture = value;",
    );
    writeFixture(
      root,
      'worker.js',
      "import {value} from 'worker-only'; globalThis.fixture = value;",
    );
    writeFixture(root, 'sw.js', "import {value} from 'serwist'; globalThis.fixture = value;");
    const notices = createBundledNotices({ root });
    /** @type {Array<Awaited<ReturnType<typeof bundle>>[number]>} */
    let workerOutput = [];
    /** @type {import('vite').Plugin} */
    const childAndAssets = {
      name: 'fixture-child-and-fonts',
      async buildStart() {
        workerOutput = await bundle(root, 'worker.js', [notices.plugin('worker')]);
      },
      generateBundle() {
        for (const name of [
          '@fontsource-variable/inter',
          '@fontsource-variable/jetbrains-mono',
          'maplibre-gl',
        ]) {
          this.emitFile({
            type: 'asset',
            fileName: `${name.replaceAll('/', '-')}.woff2`,
            originalFileName: `node_modules/${name}/font.woff2`,
            source: 'fixture',
          });
        }
      },
    };
    const app = await bundle(root, 'app.js', [notices.plugin('app'), childAndAssets]);
    const serviceWorker = await bundle(root, 'sw.js', [notices.plugin('service-worker')]);
    const manifestAsset = serviceWorker.find(
      (file) => file.fileName === 'THIRD_PARTY_NOTICES.json',
    );
    assert.equal(manifestAsset?.type, 'asset');
    assert.ok(manifestAsset && 'source' in manifestAsset);
    const manifest = JSON.parse(String(manifestAsset.source));
    assert.deepEqual(manifest.buildScopes, ['app', 'service-worker', 'worker']);
    assert.deepEqual(
      manifest.packages.map((/** @type {{name: string}} */ pkg) => pkg.name).sort(),
      [
        '@fontsource-variable/inter',
        '@fontsource-variable/jetbrains-mono',
        'included',
        'maplibre-gl',
        'serwist',
        'worker-only',
      ],
    );
    const text = renderBundledNotices(manifest);
    assert.ok(text.includes('Copyright worker-only'));
    assert.ok(!text.includes('Copyright unused'));
    const paths = new Set(
      [...app, ...workerOutput, ...serviceWorker].map((file) => `public/${file.fileName}`),
    );
    assert.deepEqual(bundledNoticeFailures(manifest, text, paths), []);
    assert.ok(bundledNoticeFailures(manifest, `${text}altered`, paths).length);
    paths.delete(`public/${serviceWorker.find((file) => file.type === 'chunk')?.fileName}`);
    assert.ok(bundledNoticeFailures(manifest, text, paths).length);
    manifest.buildScopes = ['app'];
    assert.ok(
      bundledNoticeFailures(manifest, text, paths).some((message) =>
        message.includes('service-worker'),
      ),
    );
    assert.deepEqual(bundledNoticeFailures({}, '', paths), [
      'Third-party notice manifest is empty or invalid.',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails closed for an emitted package without license text', async () => {
  const root = mkdtempSync(join(tmpdir(), 'binnacle-notices-missing-'));
  try {
    dependency(root, 'missing-license', false);
    writeFixture(
      root,
      'app.js',
      "import {value} from 'missing-license'; globalThis.fixture = value;",
    );
    await assert.rejects(
      bundle(root, 'app.js', [createBundledNotices({ root }).plugin('app')]),
      /has no complete license text/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

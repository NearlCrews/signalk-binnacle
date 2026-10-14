import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unresolvableStoreLinks } from './store-links.mjs';

/** @param {string} source */
const targets = (source) => unresolvableStoreLinks(source).map((failure) => failure.target);

test('rejects relative inline links, reference definitions, and HTML anchors', () => {
  const source = [
    'See [the guide](docs/offline-charts.md) and [notes](<CHANGELOG.md#v0220>).',
    '[up](../LICENSE) [root](/signalk-binnacle/)',
    '[guide]: docs/releasing.md',
    '<a href="docs/tracks.md">tracks</a> <a class="x" href=\'SECURITY.md\'>policy</a>',
    '<a href=LICENSE>license</a>',
  ].join('\n');
  assert.deepEqual(targets(source), [
    'docs/offline-charts.md',
    'CHANGELOG.md#v0220',
    '../LICENSE',
    '/signalk-binnacle/',
    'docs/releasing.md',
    'docs/tracks.md',
    'SECURITY.md',
    'LICENSE',
  ]);
});

test('rejects schemes other than http, https, and mailto', () => {
  const source = '[a](ftp://example.com) [b](javascript:alert) [c](//cdn.example.com/x)';
  assert.deepEqual(targets(source), [
    'ftp://example.com',
    'javascript:alert',
    '//cdn.example.com/x',
  ]);
});

test('accepts absolute web links, mail links, and in-page anchors', () => {
  const source = [
    '[npm](https://www.npmjs.com/package/signalk-binnacle) [plain](http://example.com)',
    '[upper](HTTPS://EXAMPLE.COM) [mail](mailto:someone@example.com) [jump](#development)',
    '[ref]: https://example.com/reference',
    '<a href="https://example.com">site</a> <a id="v0220"></a> <a data-href="docs/x.md">x</a>',
  ].join('\n');
  assert.deepEqual(targets(source), []);
});

test('allows relative image paths but still checks the link around a linked image', () => {
  const source = [
    '![Chart](screenshots/01-chart.png) <img src="binnacle-icon.svg" alt="">',
    '[![CI](https://example.com/badge.svg)](https://example.com/ci)',
    '[![Chart](screenshots/01-chart.png)](docs/README.md)',
  ].join('\n');
  assert.deepEqual(targets(source), ['docs/README.md']);
});

test('ignores fenced code, code spans, and footnote definitions, and reports line numbers', () => {
  const source = [
    '```markdown',
    '[inside a fence](docs/x.md)',
    '```',
    'Write `[text](docs/x.md)` to link, but never [this](docs/y.md).',
    '[^1]: docs/z.md is described here',
  ].join('\n');
  assert.deepEqual(unresolvableStoreLinks(source), [{ line: 4, target: 'docs/y.md' }]);
});

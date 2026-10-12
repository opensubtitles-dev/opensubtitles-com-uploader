import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManifest,
  releaseAssetName,
} from '../../scripts/build/generate-updater-manifest.js';

/**
 * The manifest published for v2.0.0 had an empty signature for every platform
 * and URLs that named files the release never contained. These tests pin the
 * two properties that would have caught it: URLs come from what was built, and
 * a manifest that would break auto-update is refused, not written.
 */

const REPO = 'opensubtitles-dev/opensubtitles-com-uploader';
const BASE = `https://github.com/${REPO}/releases/download/v2.0.1`;

// The file names Tauri produces for productName "OpenSubtitles Uploader".
const goodSignatures = () => [
  { file: 'OpenSubtitles Uploader_2.0.1_x64-setup.exe.sig', signature: 'WINSIG\n' },
  { file: 'OpenSubtitles Uploader.app.tar.gz.sig', signature: 'MACSIG\n' },
  { file: 'OpenSubtitles Uploader_2.0.1_amd64.AppImage.sig', signature: 'LINUXSIG\n' },
];

const build = overrides =>
  buildManifest({
    version: 'v2.0.1',
    repo: REPO,
    signatures: goodSignatures(),
    notes: 'Fixes',
    pubDate: '2026-01-01T00:00:00Z',
    ...overrides,
  });

describe('releaseAssetName', () => {
  test('applies the rename GitHub applies to uploaded assets', () => {
    assert.equal(
      releaseAssetName('OpenSubtitles Uploader_2.0.1_x64-setup.exe'),
      'OpenSubtitles.Uploader_2.0.1_x64-setup.exe'
    );
  });
});

describe('buildManifest', () => {
  test('builds every platform from the signature files that exist', () => {
    const { manifest, errors } = build();

    assert.deepEqual(errors, []);
    assert.equal(manifest.version, 'v2.0.1');
    assert.equal(manifest.notes, 'Fixes');
    assert.equal(manifest.pub_date, '2026-01-01T00:00:00Z');
    assert.deepEqual(manifest.platforms['windows-x86_64'], {
      signature: 'WINSIG',
      url: `${BASE}/OpenSubtitles.Uploader_2.0.1_x64-setup.exe`,
    });
    assert.deepEqual(manifest.platforms['linux-x86_64'], {
      signature: 'LINUXSIG',
      url: `${BASE}/OpenSubtitles.Uploader_2.0.1_amd64.AppImage`,
    });
  });

  test('the one universal macOS archive serves all three darwin keys', () => {
    const { manifest } = build();
    const expected = { signature: 'MACSIG', url: `${BASE}/OpenSubtitles.Uploader.app.tar.gz` };

    assert.deepEqual(manifest.platforms['darwin-universal'], expected);
    assert.deepEqual(manifest.platforms['darwin-x86_64'], expected);
    assert.deepEqual(manifest.platforms['darwin-aarch64'], expected);
  });

  test('refuses an empty signature — the exact v2.0.0 failure', () => {
    const signatures = goodSignatures();
    signatures[1].signature = '  \n';

    const { manifest, errors } = build({ signatures });

    assert.equal(manifest, null);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Empty updater signature/);
    assert.match(errors[0], /darwin-universal/);
  });

  test('refuses when a platform produced no signature at all', () => {
    const signatures = goodSignatures().filter(s => !s.file.endsWith('.app.tar.gz.sig'));

    const { manifest, errors } = build({ signatures });

    assert.equal(manifest, null);
    assert.match(errors[0], /No macOS updater signature/);
  });

  test('a .dmg signature does not count as a macOS updater artifact', () => {
    const signatures = goodSignatures().filter(s => !s.file.endsWith('.app.tar.gz.sig'));
    signatures.push({ file: 'OpenSubtitles Uploader_2.0.1_universal.dmg.sig', signature: 'X' });

    const { manifest, errors } = build({ signatures });

    assert.equal(manifest, null);
    assert.match(errors[0], /No macOS updater signature/);
  });

  test('reports every broken platform at once, not just the first', () => {
    const { errors } = build({ signatures: [] });
    assert.equal(errors.length, 3);
  });

  test('refuses two candidates for one platform rather than guessing', () => {
    const signatures = [
      ...goodSignatures(),
      { file: 'Other_2.0.1_x64-setup.exe.sig', signature: 'X' },
    ];

    const { manifest, errors } = build({ signatures });

    assert.equal(manifest, null);
    assert.match(errors[0], /2 Windows signatures found/);
  });

  test('refuses a URL that is not among the release assets', () => {
    const { manifest, errors } = build({
      releaseAssets: [
        'OpenSubtitles.Uploader_2.0.1_x64-setup.exe',
        'OpenSubtitles.Uploader.app.tar.gz',
        // AppImage missing from the release
      ],
    });

    assert.equal(manifest, null);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /OpenSubtitles\.Uploader_2\.0\.1_amd64\.AppImage/);
    assert.match(errors[0], /404/);
  });

  test('accepts when every URL is among the release assets', () => {
    const { errors } = build({
      releaseAssets: [
        'latest.json',
        'OpenSubtitles.Uploader_2.0.1_x64-setup.exe',
        'OpenSubtitles.Uploader.app.tar.gz',
        'OpenSubtitles.Uploader_2.0.1_amd64.AppImage',
        'OpenSubtitles.Uploader_2.0.1_universal.dmg',
      ],
    });
    assert.deepEqual(errors, []);
  });

  test('notes with quotes and newlines survive as JSON', () => {
    const notes = 'He said "hi"\nSecond line \\ backslash';
    const { manifest } = build({ notes });
    assert.equal(JSON.parse(JSON.stringify(manifest)).notes, notes);
  });
});
